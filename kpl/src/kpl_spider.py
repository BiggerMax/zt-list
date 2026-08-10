"""
开盘啦APP直接接口爬虫
通过抓包获取的接口进行数据采集
"""
import time
import requests
from typing import Optional, Dict, List, Any
from loguru import logger
from datetime import datetime

import sys
sys.path.append('..')
from config import KPL_BASE_URL, KPL_API, KPL_HEADERS, REQUEST_TIMEOUT, RETRY_TIMES, REQUEST_INTERVAL
from .utils import retry, Timer, get_trade_date, format_time


class KPLSpider:
    """开盘啦爬虫类"""
    
    def __init__(self):
        self.base_url = KPL_BASE_URL
        self.headers = KPL_HEADERS.copy()
        self.session = requests.Session()
        self.session.headers.update(self.headers)
        logger.info("开盘啦爬虫初始化完成")
    
    @retry(max_retries=RETRY_TIMES, delay=REQUEST_INTERVAL)
    def _request(self, endpoint: str, method: str = "GET", params: Optional[Dict] = None, 
                 data: Optional[Dict] = None) -> Dict[str, Any]:
        """
        发送HTTP请求
        
        Args:
            endpoint: API端点
            method: 请求方法
            params: URL参数
            data: POST数据
        
        Returns:
            响应JSON数据
        """
        url = f"{self.base_url}{endpoint}"
        
        try:
            if method.upper() == "GET":
                response = self.session.get(url, params=params, timeout=REQUEST_TIMEOUT)
            else:
                response = self.session.post(url, json=data, timeout=REQUEST_TIMEOUT)
            
            response.raise_for_status()
            result = response.json()
            
            # 检查业务状态码
            if result.get("code") != 0 and result.get("success") is not True:
                logger.warning(f"API返回错误: {result.get('msg', '未知错误')}")
                return {"data": [], "success": False}
            
            return result
            
        except requests.exceptions.RequestException as e:
            logger.error(f"请求失败: {url}, 错误: {e}")
            raise
        except Exception as e:
            logger.error(f"未知错误: {e}")
            raise
    
    def get_limit_up_pool(self, trade_date: Optional[str] = None) -> List[Dict]:
        """
        获取涨停池数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            涨停股票列表
        """
        with Timer("获取涨停池数据"):
            trade_date = trade_date or get_trade_date()
            
            params = {
                "date": trade_date,
                "type": "limit_up"
            }
            
            result = self._request(KPL_API["limit_up_pool"], params=params)
            data = result.get("data", [])
            
            logger.info(f"获取到 {len(data)} 只涨停股票")
            return self._process_limit_data(data)
    
    def get_limit_down_pool(self, trade_date: Optional[str] = None) -> List[Dict]:
        """
        获取跌停池数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            跌停股票列表
        """
        with Timer("获取跌停池数据"):
            trade_date = trade_date or get_trade_date()
            
            params = {
                "date": trade_date,
                "type": "limit_down"
            }
            
            result = self._request(KPL_API["limit_down_pool"], params=params)
            data = result.get("data", [])
            
            logger.info(f"获取到 {len(data)} 只跌停股票")
            return self._process_limit_data(data)
    
    def get_break_pool(self, trade_date: Optional[str] = None) -> List[Dict]:
        """
        获取炸板池数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            炸板股票列表
        """
        with Timer("获取炸板池数据"):
            trade_date = trade_date or get_trade_date()
            
            params = {
                "date": trade_date,
                "type": "break"
            }
            
            result = self._request(KPL_API["break_pool"], params=params)
            data = result.get("data", [])
            
            logger.info(f"获取到 {len(data)} 只炸板股票")
            return self._process_limit_data(data)
    
    def get_bidding_data(self, trade_date: Optional[str] = None) -> List[Dict]:
        """
        获取竞价数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            竞价数据列表
        """
        with Timer("获取竞价数据"):
            trade_date = trade_date or get_trade_date()
            
            params = {
                "date": trade_date
            }
            
            result = self._request(KPL_API["bidding"], params=params)
            data = result.get("data", [])
            
            logger.info(f"获取到 {len(data)} 只竞价股票")
            return self._process_bidding_data(data)
    
    def get_near_limit(self) -> List[Dict]:
        """
        获取即将涨停数据（实时）
        
        Returns:
            即将涨停股票列表
        """
        with Timer("获取即将涨停数据"):
            result = self._request(KPL_API["near_limit"])
            data = result.get("data", [])
            
            logger.info(f"获取到 {len(data)} 只即将涨停股票")
            return self._process_limit_data(data)
    
    def get_market_emotion(self, trade_date: Optional[str] = None) -> Dict:
        """
        获取市场情绪数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            市场情绪数据
        """
        with Timer("获取市场情绪数据"):
            trade_date = trade_date or get_trade_date()
            
            params = {
                "date": trade_date
            }
            
            result = self._request(KPL_API["emotion"], params=params)
            data = result.get("data", {})
            
            logger.info("市场情绪数据获取成功")
            return self._process_emotion_data(data)
    
    def get_dragon_list(self, trade_date: Optional[str] = None) -> List[Dict]:
        """
        获取龙虎榜数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            龙虎榜数据列表
        """
        with Timer("获取龙虎榜数据"):
            trade_date = trade_date or get_trade_date()
            
            params = {
                "date": trade_date
            }
            
            result = self._request(KPL_API["dragon"], params=params)
            data = result.get("data", [])
            
            logger.info(f"获取到 {len(data)} 条龙虎榜数据")
            return data
    
    def get_stock_detail(self, stock_code: str, trade_date: Optional[str] = None) -> Dict:
        """
        获取个股详细信息
        
        Args:
            stock_code: 股票代码
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            个股详细数据
        """
        with Timer(f"获取 {stock_code} 详细信息"):
            trade_date = trade_date or get_trade_date()
            
            params = {
                "code": stock_code,
                "date": trade_date
            }
            
            result = self._request(KPL_API["limit_up_detail"], params=params)
            data = result.get("data", {})
            
            return data
    
    def _process_limit_data(self, data: List[Dict]) -> List[Dict]:
        """
        处理涨停/跌停数据
        
        Args:
            data: 原始数据
        
        Returns:
            处理后的数据
        """
        processed = []
        
        for item in data:
            processed_item = {
                "ts_code": item.get("code", ""),
                "name": item.get("name", ""),
                "trade_date": item.get("date", ""),
                "lu_time": format_time(item.get("limit_time", "")),
                "ld_time": format_time(item.get("down_time", "")),
                "open_time": format_time(item.get("open_time", "")),
                "last_time": format_time(item.get("last_time", "")),
                "lu_desc": item.get("reason", ""),
                "theme": item.get("concept", ""),
                "status": item.get("status", ""),
                "pct_chg": item.get("change_rate", 0),
                "limit_order": item.get("seal_amount", 0),
                "amount": item.get("amount", 0),
                "turnover_rate": item.get("turnover", 0),
                "net_change": item.get("net_inflow", 0),
            }
            processed.append(processed_item)
        
        return processed
    
    def _process_bidding_data(self, data: List[Dict]) -> List[Dict]:
        """
        处理竞价数据
        
        Args:
            data: 原始数据
        
        Returns:
            处理后的数据
        """
        processed = []
        
        for item in data:
            processed_item = {
                "ts_code": item.get("code", ""),
                "name": item.get("name", ""),
                "trade_date": item.get("date", ""),
                "bid_pct_chg": item.get("bid_change", 0),
                "bid_amount": item.get("bid_amount", 0),
                "bid_turnover": item.get("bid_turnover", 0),
                "theme": item.get("concept", ""),
            }
            processed.append(processed_item)
        
        return processed
    
    def _process_emotion_data(self, data: Dict) -> Dict:
        """
        处理市场情绪数据
        
        Args:
            data: 原始数据
        
        Returns:
            处理后的数据
        """
        return {
            "trade_date": data.get("date", ""),
            "limit_up_count": data.get("limit_up_count", 0),
            "limit_down_count": data.get("limit_down_count", 0),
            "break_count": data.get("break_count", 0),
            "emotion_index": data.get("emotion", 0),
            "money_effect": data.get("money_effect", 0),
        }
    
    def close(self):
        """关闭会话"""
        self.session.close()
        logger.info("爬虫会话已关闭")


if __name__ == "__main__":
    # 测试代码
    spider = KPLSpider()
    
    try:
        # 获取今日涨停数据
        limit_up = spider.get_limit_up_pool()
        print(f"\n今日涨停: {len(limit_up)} 只")
        if limit_up:
            print(limit_up[0])
        
        # 获取市场情绪
        emotion = spider.get_market_emotion()
        print(f"\n市场情绪: {emotion}")
        
    finally:
        spider.close()
