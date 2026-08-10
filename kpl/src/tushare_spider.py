"""
Tushare API 数据获取模块
使用Tushare提供的开盘啦数据接口
"""
from typing import Optional, List, Dict
import pandas as pd
from loguru import logger

try:
    import tushare as ts
except ImportError:
    logger.warning("Tushare未安装，请运行: pip install tushare")
    ts = None

import sys
sys.path.append('..')
from config import TUSHARE_TOKEN
from .utils import Timer, get_trade_date, validate_date


class TushareSpider:
    """Tushare数据获取类"""
    
    def __init__(self, token: Optional[str] = None):
        """
        初始化Tushare API
        
        Args:
            token: Tushare API Token
        """
        if ts is None:
            raise ImportError("请先安装tushare: pip install tushare")
        
        self.token = token or TUSHARE_TOKEN
        
        if not self.token or self.token == "your_tushare_token_here":
            raise ValueError(
                "请设置Tushare Token!\n"
                "1. 注册账号: https://tushare.pro/register\n"
                "2. 获取Token: https://tushare.pro/user/token\n"
                "3. 在config.py中设置TUSHARE_TOKEN或设置环境变量"
            )
        
        ts.set_token(self.token)
        self.pro = ts.pro_api()
        logger.info("Tushare API初始化完成")
    
    def get_kpl_list(self, 
                     trade_date: Optional[str] = None,
                     tag: str = "涨停",
                     ts_code: Optional[str] = None,
                     start_date: Optional[str] = None,
                     end_date: Optional[str] = None) -> pd.DataFrame:
        """
        获取开盘啦榜单数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
            tag: 榜单类型 ('涨停', '跌停', '炸板', '自然涨停', '竞价')
            ts_code: 股票代码
            start_date: 开始日期
            end_date: 结束日期
        
        Returns:
            DataFrame格式的数据
        """
        with Timer(f"获取{tag}数据"):
            try:
                df = self.pro.kpl_list(
                    ts_code=ts_code,
                    trade_date=trade_date,
                    tag=tag,
                    start_date=start_date,
                    end_date=end_date
                )
                
                if df is None or df.empty:
                    logger.warning(f"未获取到数据: tag={tag}, date={trade_date}")
                    return pd.DataFrame()
                
                logger.info(f"获取到 {len(df)} 条{tag}数据")
                return df
                
            except Exception as e:
                logger.error(f"获取数据失败: {e}")
                return pd.DataFrame()
    
    def get_limit_up(self, trade_date: Optional[str] = None) -> pd.DataFrame:
        """
        获取涨停数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            涨停数据DataFrame
        """
        trade_date = trade_date or get_trade_date()
        return self.get_kpl_list(trade_date=trade_date, tag="涨停")
    
    def get_limit_down(self, trade_date: Optional[str] = None) -> pd.DataFrame:
        """
        获取跌停数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            跌停数据DataFrame
        """
        trade_date = trade_date or get_trade_date()
        return self.get_kpl_list(trade_date=trade_date, tag="跌停")
    
    def get_break_board(self, trade_date: Optional[str] = None) -> pd.DataFrame:
        """
        获取炸板数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            炸板数据DataFrame
        """
        trade_date = trade_date or get_trade_date()
        return self.get_kpl_list(trade_date=trade_date, tag="炸板")
    
    def get_natural_limit(self, trade_date: Optional[str] = None) -> pd.DataFrame:
        """
        获取自然涨停数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            自然涨停数据DataFrame
        """
        trade_date = trade_date or get_trade_date()
        return self.get_kpl_list(trade_date=trade_date, tag="自然涨停")
    
    def get_bidding(self, trade_date: Optional[str] = None) -> pd.DataFrame:
        """
        获取竞价数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            竞价数据DataFrame
        """
        trade_date = trade_date or get_trade_date()
        return self.get_kpl_list(trade_date=trade_date, tag="竞价")
    
    def get_history_data(self, 
                        start_date: str,
                        end_date: str,
                        tag: str = "涨停") -> pd.DataFrame:
        """
        获取历史数据
        
        Args:
            start_date: 开始日期 (YYYYMMDD)
            end_date: 结束日期 (YYYYMMDD)
            tag: 榜单类型
        
        Returns:
            历史数据DataFrame
        """
        if not validate_date(start_date) or not validate_date(end_date):
            logger.error("日期格式错误，应为YYYYMMDD")
            return pd.DataFrame()
        
        return self.get_kpl_list(start_date=start_date, end_date=end_date, tag=tag)
    
    def get_kpl_concept(self, trade_date: Optional[str] = None) -> pd.DataFrame:
        """
        获取开盘啦题材数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            题材数据DataFrame
        """
        with Timer("获取题材数据"):
            try:
                trade_date = trade_date or get_trade_date()
                df = self.pro.kpl_concept(trade_date=trade_date)
                
                if df is None or df.empty:
                    logger.warning(f"未获取到题材数据: date={trade_date}")
                    return pd.DataFrame()
                
                logger.info(f"获取到 {len(df)} 条题材数据")
                return df
                
            except Exception as e:
                logger.error(f"获取题材数据失败: {e}")
                return pd.DataFrame()
    
    def get_kpl_concept_cons(self, concept: str, trade_date: Optional[str] = None) -> pd.DataFrame:
        """
        获取开盘啦题材成分
        
        Args:
            concept: 题材名称
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            题材成分DataFrame
        """
        with Timer(f"获取题材成分: {concept}"):
            try:
                trade_date = trade_date or get_trade_date()
                df = self.pro.kpl_concept_cons(
                    concept=concept,
                    trade_date=trade_date
                )
                
                if df is None or df.empty:
                    logger.warning(f"未获取到题材成分: {concept}")
                    return pd.DataFrame()
                
                logger.info(f"获取到 {len(df)} 只{concept}成分股")
                return df
                
            except Exception as e:
                logger.error(f"获取题材成分失败: {e}")
                return pd.DataFrame()
    
    def get_stock_info(self, ts_code: str, trade_date: Optional[str] = None) -> pd.DataFrame:
        """
        获取个股在榜单中的信息
        
        Args:
            ts_code: 股票代码
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            个股信息DataFrame
        """
        trade_date = trade_date or get_trade_date()
        return self.get_kpl_list(ts_code=ts_code, trade_date=trade_date)
    
    def get_all_data(self, trade_date: Optional[str] = None) -> Dict[str, pd.DataFrame]:
        """
        获取所有类型的数据
        
        Args:
            trade_date: 交易日期 (YYYYMMDD)
        
        Returns:
            包含所有数据的字典
        """
        trade_date = trade_date or get_trade_date()
        
        logger.info(f"开始获取 {trade_date} 的所有数据")
        
        data = {
            "涨停": self.get_limit_up(trade_date),
            "跌停": self.get_limit_down(trade_date),
            "炸板": self.get_break_board(trade_date),
            "自然涨停": self.get_natural_limit(trade_date),
            "竞价": self.get_bidding(trade_date),
            "题材": self.get_kpl_concept(trade_date),
        }
        
        total_count = sum(len(df) for df in data.values() if not df.empty)
        logger.info(f"共获取 {total_count} 条数据")
        
        return data
    
    def to_dict_list(self, df: pd.DataFrame) -> List[Dict]:
        """
        将DataFrame转换为字典列表
        
        Args:
            df: DataFrame
        
        Returns:
            字典列表
        """
        if df.empty:
            return []
        return df.to_dict('records')


if __name__ == "__main__":
    # 测试代码
    try:
        spider = TushareSpider()
        
        # 获取今日涨停数据
        df = spider.get_limit_up()
        print(f"\n今日涨停: {len(df)} 只")
        if not df.empty:
            print(df.head())
        
        # 获取题材数据
        concepts = spider.get_kpl_concept()
        print(f"\n题材数量: {len(concepts)}")
        if not concepts.empty:
            print(concepts.head())
        
    except Exception as e:
        logger.error(f"测试失败: {e}")
