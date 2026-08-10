"""
开盘啦打板数据爬虫 - 主程序
"""
import click
from loguru import logger
from datetime import datetime
from pathlib import Path

from config import LOG_DIR, LOG_LEVEL, LOG_FORMAT, DATA_SOURCE
from src.kpl_spider import KPLSpider
from src.tushare_spider import TushareSpider
from src.data_processor import DataProcessor
from src.utils import get_trade_date, validate_date, Timer


# 配置日志
logger.remove()
logger.add(
    LOG_DIR / f"kpl_{datetime.now().strftime('%Y%m%d')}.log",
    rotation="1 day",
    retention="30 days",
    level=LOG_LEVEL,
    format=LOG_FORMAT,
    encoding="utf-8"
)
logger.add(
    lambda msg: print(msg, end=""),
    level=LOG_LEVEL,
    format=LOG_FORMAT,
    colorize=True
)


class KPLCrawler:
    """开盘啦爬虫主类"""
    
    def __init__(self, data_source: str = DATA_SOURCE):
        """
        初始化爬虫
        
        Args:
            data_source: 数据源 ('kpl' 或 'tushare')
        """
        self.data_source = data_source
        self.processor = DataProcessor()
        
        if data_source == "kpl":
            self.spider = KPLSpider()
            logger.info("使用开盘啦直接接口")
        elif data_source == "tushare":
            self.spider = TushareSpider()
            logger.info("使用Tushare API")
        else:
            raise ValueError(f"不支持的数据源: {data_source}")
    
    def get_today_limit_up(self, export_format: str = "excel"):
        """获取今日涨停数据"""
        logger.info("=" * 60)
        logger.info("开始获取今日涨停数据")
        logger.info("=" * 60)
        
        with Timer("获取今日涨停数据"):
            if self.data_source == "kpl":
                data = self.spider.get_limit_up_pool()
            else:
                df = self.spider.get_limit_up()
                data = df
            
            if isinstance(data, list) and not data:
                logger.warning("未获取到数据")
                return
            
            # 清洗数据
            df = self.processor.clean_data(data)
            
            # 按涨停时间排序
            df = self.processor.sort_data(df, by="lu_time")
            
            # 获取统计信息
            stats = self.processor.get_statistics(df)
            logger.info(f"涨停股票数量: {stats.get('total_count', 0)}")
            
            # 导出数据
            filename = f"limit_up_{get_trade_date()}"
            filepath = self.processor.export(df, filename, format=export_format)
            
            logger.success(f"✅ 数据已保存到: {filepath}")
            
            # 显示前10条
            self._display_data(df.head(10), "今日涨停TOP10")
            
            return df
    
    def get_today_limit_down(self, export_format: str = "excel"):
        """获取今日跌停数据"""
        logger.info("=" * 60)
        logger.info("开始获取今日跌停数据")
        logger.info("=" * 60)
        
        with Timer("获取今日跌停数据"):
            if self.data_source == "kpl":
                data = self.spider.get_limit_down_pool()
            else:
                df = self.spider.get_limit_down()
                data = df
            
            if isinstance(data, list) and not data:
                logger.warning("未获取到数据")
                return
            
            df = self.processor.clean_data(data)
            df = self.processor.sort_data(df, by="ld_time")
            
            stats = self.processor.get_statistics(df)
            logger.info(f"跌停股票数量: {stats.get('total_count', 0)}")
            
            filename = f"limit_down_{get_trade_date()}"
            filepath = self.processor.export(df, filename, format=export_format)
            
            logger.success(f"✅ 数据已保存到: {filepath}")
            self._display_data(df.head(10), "今日跌停TOP10")
            
            return df
    
    def get_today_break(self, export_format: str = "excel"):
        """获取今日炸板数据"""
        logger.info("=" * 60)
        logger.info("开始获取今日炸板数据")
        logger.info("=" * 60)
        
        with Timer("获取今日炸板数据"):
            if self.data_source == "kpl":
                data = self.spider.get_break_pool()
            else:
                df = self.spider.get_break_board()
                data = df
            
            if isinstance(data, list) and not data:
                logger.warning("未获取到数据")
                return
            
            df = self.processor.clean_data(data)
            
            stats = self.processor.get_statistics(df)
            logger.info(f"炸板股票数量: {stats.get('total_count', 0)}")
            
            filename = f"break_board_{get_trade_date()}"
            filepath = self.processor.export(df, filename, format=export_format)
            
            logger.success(f"✅ 数据已保存到: {filepath}")
            self._display_data(df.head(10), "今日炸板TOP10")
            
            return df
    
    def get_history_data(self, start_date: str, end_date: str, 
                        tag: str = "涨停", export_format: str = "excel"):
        """获取历史数据"""
        logger.info("=" * 60)
        logger.info(f"开始获取历史{tag}数据: {start_date} ~ {end_date}")
        logger.info("=" * 60)
        
        if not validate_date(start_date) or not validate_date(end_date):
            logger.error("日期格式错误，应为YYYYMMDD")
            return
        
        if self.data_source != "tushare":
            logger.warning("历史数据获取仅支持Tushare数据源")
            return
        
        with Timer(f"获取历史{tag}数据"):
            df = self.spider.get_history_data(start_date, end_date, tag=tag)
            
            if df.empty:
                logger.warning("未获取到数据")
                return
            
            df = self.processor.clean_data(df)
            
            stats = self.processor.get_statistics(df)
            logger.info(f"共获取 {stats.get('total_count', 0)} 条数据")
            
            filename = f"history_{tag}_{start_date}_{end_date}"
            filepath = self.processor.export(df, filename, format=export_format)
            
            logger.success(f"✅ 数据已保存到: {filepath}")
            
            return df
    
    def get_all_today_data(self, export_format: str = "excel"):
        """获取今日所有数据"""
        logger.info("=" * 60)
        logger.info("开始获取今日所有数据")
        logger.info("=" * 60)
        
        if self.data_source != "tushare":
            logger.warning("获取所有数据仅支持Tushare数据源")
            return
        
        with Timer("获取今日所有数据"):
            data_dict = self.spider.get_all_data()
            
            # 清洗所有数据
            for key in data_dict:
                if not data_dict[key].empty:
                    data_dict[key] = self.processor.clean_data(data_dict[key])
            
            # 导出为多工作表Excel
            filename = f"all_data_{get_trade_date()}"
            filepath = self.processor.export_multi_sheet_excel(data_dict, filename)
            
            logger.success(f"✅ 数据已保存到: {filepath}")
            
            # 显示统计信息
            for key, df in data_dict.items():
                if not df.empty:
                    logger.info(f"{key}: {len(df)} 条")
            
            return data_dict
    
    def _display_data(self, df, title: str = "数据预览"):
        """显示数据"""
        if df.empty:
            return
        
        logger.info(f"\n{title}:")
        logger.info("-" * 80)
        
        # 选择要显示的列
        display_cols = ['name', 'lu_time', 'theme', 'status', 'pct_chg']
        available_cols = [col for col in display_cols if col in df.columns]
        
        if available_cols:
            print(df[available_cols].to_string(index=False))
        else:
            print(df.head().to_string(index=False))
        
        logger.info("-" * 80)
    
    def close(self):
        """关闭爬虫"""
        if hasattr(self.spider, 'close'):
            self.spider.close()


@click.group()
def cli():
    """开盘啦打板数据爬虫工具"""
    pass


@cli.command()
@click.option('--source', default=DATA_SOURCE, help='数据源 (kpl/tushare)')
@click.option('--format', default='excel', help='导出格式 (csv/excel/json)')
def today_limit(source, format):
    """获取今日涨停数据"""
    crawler = KPLCrawler(data_source=source)
    try:
        crawler.get_today_limit_up(export_format=format)
    finally:
        crawler.close()


@cli.command()
@click.option('--source', default=DATA_SOURCE, help='数据源 (kpl/tushare)')
@click.option('--format', default='excel', help='导出格式 (csv/excel/json)')
def today_down(source, format):
    """获取今日跌停数据"""
    crawler = KPLCrawler(data_source=source)
    try:
        crawler.get_today_limit_down(export_format=format)
    finally:
        crawler.close()


@cli.command()
@click.option('--source', default=DATA_SOURCE, help='数据源 (kpl/tushare)')
@click.option('--format', default='excel', help='导出格式 (csv/excel/json)')
def today_break(source, format):
    """获取今日炸板数据"""
    crawler = KPLCrawler(data_source=source)
    try:
        crawler.get_today_break(export_format=format)
    finally:
        crawler.close()


@cli.command()
@click.option('--start', required=True, help='开始日期 (YYYYMMDD)')
@click.option('--end', required=True, help='结束日期 (YYYYMMDD)')
@click.option('--tag', default='涨停', help='数据类型 (涨停/跌停/炸板)')
@click.option('--format', default='excel', help='导出格式 (csv/excel/json)')
def history(start, end, tag, format):
    """获取历史数据（仅支持Tushare）"""
    crawler = KPLCrawler(data_source='tushare')
    try:
        crawler.get_history_data(start, end, tag=tag, export_format=format)
    finally:
        crawler.close()


@cli.command()
@click.option('--format', default='excel', help='导出格式')
def today_all(format):
    """获取今日所有数据（仅支持Tushare）"""
    crawler = KPLCrawler(data_source='tushare')
    try:
        crawler.get_all_today_data(export_format=format)
    finally:
        crawler.close()


if __name__ == "__main__":
    cli()
