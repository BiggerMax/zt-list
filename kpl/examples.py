"""
示例脚本：展示如何使用爬虫
"""
from loguru import logger
from src.kpl_spider import KPLSpider
from src.tushare_spider import TushareSpider
from src.data_processor import DataProcessor


def example_kpl_spider():
    """示例：使用开盘啦直接接口"""
    logger.info("=" * 60)
    logger.info("示例1: 使用开盘啦直接接口获取数据")
    logger.info("=" * 60)
    
    spider = KPLSpider()
    processor = DataProcessor()
    
    try:
        # 1. 获取今日涨停数据
        logger.info("\n1. 获取今日涨停数据")
        limit_up = spider.get_limit_up_pool()
        logger.info(f"涨停数量: {len(limit_up)}")
        
        # 2. 获取市场情绪
        logger.info("\n2. 获取市场情绪")
        emotion = spider.get_market_emotion()
        logger.info(f"市场情绪: {emotion}")
        
        # 3. 获取即将涨停
        logger.info("\n3. 获取即将涨停")
        near_limit = spider.get_near_limit()
        logger.info(f"即将涨停数量: {len(near_limit)}")
        
        # 4. 数据处理和导出
        if limit_up:
            logger.info("\n4. 数据处理和导出")
            df = processor.clean_data(limit_up)
            df = processor.sort_data(df, by="lu_time")
            
            # 筛选2连板以上
            high_board = processor.filter_data(df, status__in=["2连板", "3连板", "4连板"])
            logger.info(f"2连板以上: {len(high_board)} 只")
            
            # 导出
            processor.export(df, "example_limit_up", format="excel")
            logger.success("✅ 数据已导出")
        
    finally:
        spider.close()


def example_tushare_spider():
    """示例：使用Tushare API"""
    logger.info("=" * 60)
    logger.info("示例2: 使用Tushare API获取数据")
    logger.info("=" * 60)
    
    try:
        spider = TushareSpider()
        processor = DataProcessor()
        
        # 1. 获取今日涨停
        logger.info("\n1. 获取今日涨停")
        df = spider.get_limit_up()
        logger.info(f"涨停数量: {len(df)}")
        
        # 2. 获取题材数据
        logger.info("\n2. 获取题材数据")
        concepts = spider.get_kpl_concept()
        logger.info(f"题材数量: {len(concepts)}")
        
        # 3. 获取历史数据
        logger.info("\n3. 获取历史数据")
        history = spider.get_history_data("20231201", "20231208", tag="涨停")
        logger.info(f"历史数据: {len(history)} 条")
        
        # 4. 数据统计
        if not df.empty:
            logger.info("\n4. 数据统计")
            stats = processor.get_statistics(df)
            logger.info(f"统计信息: {stats}")
            
            # 板块分析
            theme_stats = processor.aggregate_data(
                df, 
                group_by="theme",
                agg_func={"ts_code": "count", "amount": "sum"}
            )
            logger.info(f"\n板块统计:\n{theme_stats}")
        
    except Exception as e:
        logger.error(f"示例执行失败: {e}")


def example_data_analysis():
    """示例：数据分析"""
    logger.info("=" * 60)
    logger.info("示例3: 数据分析")
    logger.info("=" * 60)
    
    try:
        spider = TushareSpider()
        processor = DataProcessor()
        
        # 获取数据
        df = spider.get_limit_up()
        
        if df.empty:
            logger.warning("无数据可分析")
            return
        
        df = processor.clean_data(df)
        
        # 1. 涨停时间分析
        logger.info("\n1. 涨停时间分布")
        time_dist = df['lu_time'].value_counts().head(10)
        logger.info(f"\n{time_dist}")
        
        # 2. 板块分析
        logger.info("\n2. 热门板块TOP10")
        theme_dist = df['theme'].value_counts().head(10)
        logger.info(f"\n{theme_dist}")
        
        # 3. 连板分析
        logger.info("\n3. 连板分布")
        status_dist = df['status'].value_counts()
        logger.info(f"\n{status_dist}")
        
        # 4. 筛选高质量涨停
        logger.info("\n4. 筛选高质量涨停（封单>1亿，换手率<10%）")
        quality = processor.filter_data(
            df,
            limit_order__gt=100000000,
            turnover_rate__lt=10
        )
        logger.info(f"符合条件: {len(quality)} 只")
        
        if not quality.empty:
            logger.info(f"\n{quality[['name', 'lu_time', 'theme', 'status']].to_string()}")
        
    except Exception as e:
        logger.error(f"分析失败: {e}")


def example_export_formats():
    """示例：不同导出格式"""
    logger.info("=" * 60)
    logger.info("示例4: 导出不同格式")
    logger.info("=" * 60)
    
    try:
        spider = TushareSpider()
        processor = DataProcessor()
        
        # 获取所有数据
        data_dict = spider.get_all_data()
        
        # 1. 导出为多工作表Excel
        logger.info("\n1. 导出多工作表Excel")
        processor.export_multi_sheet_excel(data_dict, "all_data_example")
        
        # 2. 分别导出为CSV
        logger.info("\n2. 导出CSV")
        for name, df in data_dict.items():
            if not df.empty:
                processor.export_to_csv(df, f"example_{name}")
        
        # 3. 导出为JSON
        logger.info("\n3. 导出JSON")
        limit_up = data_dict.get("涨停")
        if not limit_up.empty:
            processor.export_to_json(limit_up, "example_limit_up")
        
        logger.success("✅ 所有格式导出完成")
        
    except Exception as e:
        logger.error(f"导出失败: {e}")


if __name__ == "__main__":
    # 运行示例
    logger.info("开始运行示例脚本\n")
    
    # 选择要运行的示例
    print("请选择要运行的示例:")
    print("1. 开盘啦直接接口示例")
    print("2. Tushare API示例")
    print("3. 数据分析示例")
    print("4. 导出格式示例")
    print("5. 运行所有示例")
    
    choice = input("\n请输入选项 (1-5): ").strip()
    
    if choice == "1":
        example_kpl_spider()
    elif choice == "2":
        example_tushare_spider()
    elif choice == "3":
        example_data_analysis()
    elif choice == "4":
        example_export_formats()
    elif choice == "5":
        example_kpl_spider()
        print("\n" + "=" * 60 + "\n")
        example_tushare_spider()
        print("\n" + "=" * 60 + "\n")
        example_data_analysis()
        print("\n" + "=" * 60 + "\n")
        example_export_formats()
    else:
        logger.error("无效的选项")
