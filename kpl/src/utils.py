"""
工具函数模块
"""
import time
from datetime import datetime, timedelta
from functools import wraps
from typing import Optional, Callable, Any
from loguru import logger


def get_trade_date(date: Optional[str] = None, format: str = "%Y%m%d") -> str:
    """
    获取交易日期
    
    Args:
        date: 日期字符串，默认为今天
        format: 日期格式
    
    Returns:
        格式化后的日期字符串
    """
    if date:
        return date
    return datetime.now().strftime(format)


def parse_date(date_str: str, input_format: str = "%Y%m%d", output_format: str = "%Y-%m-%d") -> str:
    """
    解析并转换日期格式
    
    Args:
        date_str: 输入日期字符串
        input_format: 输入格式
        output_format: 输出格式
    
    Returns:
        转换后的日期字符串
    """
    try:
        dt = datetime.strptime(date_str, input_format)
        return dt.strftime(output_format)
    except ValueError:
        return date_str


def get_date_range(start_date: str, end_date: str, format: str = "%Y%m%d") -> list[str]:
    """
    获取日期范围内的所有日期
    
    Args:
        start_date: 开始日期
        end_date: 结束日期
        format: 日期格式
    
    Returns:
        日期列表
    """
    start = datetime.strptime(start_date, format)
    end = datetime.strptime(end_date, format)
    
    dates = []
    current = start
    while current <= end:
        dates.append(current.strftime(format))
        current += timedelta(days=1)
    
    return dates


def format_number(num: float, precision: int = 2) -> str:
    """
    格式化数字（带单位：万、亿）
    
    Args:
        num: 数字
        precision: 精度
    
    Returns:
        格式化后的字符串
    """
    if num is None:
        return "-"
    
    abs_num = abs(num)
    sign = "-" if num < 0 else ""
    
    if abs_num >= 100000000:  # 亿
        return f"{sign}{abs_num / 100000000:.{precision}f}亿"
    elif abs_num >= 10000:  # 万
        return f"{sign}{abs_num / 10000:.{precision}f}万"
    else:
        return f"{sign}{abs_num:.{precision}f}"


def format_time(time_str: str) -> str:
    """
    格式化时间字符串
    
    Args:
        time_str: 时间字符串（如 "093000" 或 "09:30:00"）
    
    Returns:
        格式化后的时间 "HH:MM:SS"
    """
    if not time_str:
        return "-"
    
    # 移除可能的冒号
    time_str = time_str.replace(":", "")
    
    if len(time_str) >= 6:
        return f"{time_str[:2]}:{time_str[2:4]}:{time_str[4:6]}"
    elif len(time_str) >= 4:
        return f"{time_str[:2]}:{time_str[2:4]}:00"
    
    return time_str


def retry(max_retries: int = 3, delay: float = 1.0, exceptions: tuple = (Exception,)):
    """
    重试装饰器
    
    Args:
        max_retries: 最大重试次数
        delay: 重试间隔（秒）
        exceptions: 需要捕获的异常类型
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            last_exception = None
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt < max_retries:
                        logger.warning(
                            f"函数 {func.__name__} 执行失败 (尝试 {attempt + 1}/{max_retries + 1}): {e}"
                        )
                        time.sleep(delay * (attempt + 1))  # 指数退避
                    else:
                        logger.error(f"函数 {func.__name__} 执行失败，已达到最大重试次数: {e}")
            raise last_exception
        return wrapper
    return decorator


def is_trade_time() -> bool:
    """
    判断当前是否为交易时间
    
    交易时间：
    - 上午：09:30 - 11:30
    - 下午：13:00 - 15:00
    
    Returns:
        是否为交易时间
    """
    now = datetime.now()
    weekday = now.weekday()
    
    # 周末不交易
    if weekday >= 5:
        return False
    
    current_time = now.time()
    
    # 上午交易时间
    morning_start = datetime.strptime("09:30", "%H:%M").time()
    morning_end = datetime.strptime("11:30", "%H:%M").time()
    
    # 下午交易时间
    afternoon_start = datetime.strptime("13:00", "%H:%M").time()
    afternoon_end = datetime.strptime("15:00", "%H:%M").time()
    
    return (morning_start <= current_time <= morning_end or
            afternoon_start <= current_time <= afternoon_end)


def format_stock_code(code: str, exchange: str = None) -> str:
    """
    格式化股票代码
    
    Args:
        code: 股票代码
        exchange: 交易所（SH/SZ）
    
    Returns:
        格式化后的代码（如 "000001.SZ"）
    """
    code = str(code).zfill(6)
    
    if exchange:
        return f"{code}.{exchange.upper()}"
    
    # 自动判断交易所
    if code.startswith(("6", "9")):
        return f"{code}.SH"
    elif code.startswith(("0", "2", "3")):
        return f"{code}.SZ"
    elif code.startswith(("4", "8")):
        return f"{code}.BJ"
    
    return code


def validate_date(date_str: str, format: str = "%Y%m%d") -> bool:
    """
    验证日期字符串是否有效
    
    Args:
        date_str: 日期字符串
        format: 日期格式
    
    Returns:
        是否有效
    """
    try:
        datetime.strptime(date_str, format)
        return True
    except ValueError:
        return False


def timestamp_to_datetime(timestamp: int) -> datetime:
    """
    时间戳转日期时间
    
    Args:
        timestamp: 时间戳（毫秒或秒）
    
    Returns:
        datetime对象
    """
    if timestamp > 10000000000:  # 毫秒
        timestamp = timestamp / 1000
    return datetime.fromtimestamp(timestamp)


class Timer:
    """计时器上下文管理器"""
    
    def __init__(self, name: str = "操作"):
        self.name = name
        self.start_time = None
        self.end_time = None
    
    def __enter__(self):
        self.start_time = time.time()
        return self
    
    def __exit__(self, *args):
        self.end_time = time.time()
        elapsed = self.end_time - self.start_time
        logger.info(f"{self.name} 耗时: {elapsed:.2f}秒")
    
    @property
    def elapsed(self) -> float:
        if self.end_time:
            return self.end_time - self.start_time
        return time.time() - self.start_time
