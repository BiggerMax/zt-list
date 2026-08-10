"""
开盘啦爬虫配置文件
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 项目根目录
BASE_DIR = Path(__file__).parent

# 数据存储目录
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# 日志目录
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

# ==================== Tushare 配置 ====================
# 注册地址: https://tushare.pro/register
# 获取Token后填入此处或设置环境变量 TUSHARE_TOKEN
TUSHARE_TOKEN = os.getenv("TUSHARE_TOKEN", "your_tushare_token_here")

# ==================== 开盘啦APP接口配置 ====================
# 接口基础URL（通过抓包获取）
KPL_BASE_URL = "https://flash-api.xuangubao.cn"

# 常用接口路径
KPL_API = {
    # 涨停相关
    "limit_up_pool": "/api/pool/limit-up",  # 涨停池
    "limit_up_detail": "/api/pool/detail",  # 涨停详情
    "limit_up_reason": "/api/reason/limit-up",  # 涨停原因
    
    # 跌停相关
    "limit_down_pool": "/api/pool/limit-down",  # 跌停池
    
    # 炸板相关
    "break_pool": "/api/pool/break",  # 炸板池
    
    # 竞价相关
    "bidding": "/api/pool/bidding",  # 竞价数据
    
    # 情绪相关
    "emotion": "/api/market/emotion",  # 市场情绪
    
    # 龙虎榜
    "dragon": "/api/dragon/list",  # 龙虎榜
    
    # 风向标
    "indicator": "/api/market/indicator",  # 风向标
    
    # 即将涨停
    "near_limit": "/api/pool/near-limit",  # 即将涨停
}

# 请求头配置（模拟APP请求）
KPL_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Content-Type": "application/json",
}

# ==================== 数据源选择 ====================
# 可选: "kpl" (开盘啦直接接口) 或 "tushare" (Tushare API)
DATA_SOURCE = os.getenv("DATA_SOURCE", "kpl")

# ==================== 请求配置 ====================
# 请求超时时间（秒）
REQUEST_TIMEOUT = 30

# 请求重试次数
RETRY_TIMES = 3

# 请求间隔时间（秒）
REQUEST_INTERVAL = 1

# ==================== 日志配置 ====================
LOG_LEVEL = "INFO"
LOG_FORMAT = "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"

# ==================== 榜单类型 ====================
TAG_TYPES = {
    "涨停": "limit_up",
    "跌停": "limit_down",
    "炸板": "break",
    "自然涨停": "natural_limit",
    "竞价": "bidding",
}

# ==================== 导出配置 ====================
EXPORT_FORMATS = ["csv", "json", "excel"]
DEFAULT_EXPORT_FORMAT = "excel"
