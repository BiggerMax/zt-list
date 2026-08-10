"""
测试脚本 - 验证爬虫功能
"""
import sys
from loguru import logger

# 配置简单的日志输出
logger.remove()
logger.add(sys.stdout, level="INFO", format="<level>{message}</level>", colorize=True)


def test_imports():
    """测试模块导入"""
    logger.info("=" * 60)
    logger.info("测试1: 模块导入")
    logger.info("=" * 60)
    
    try:
        from src.kpl_spider import KPLSpider
        from src.tushare_spider import TushareSpider
        from src.data_processor import DataProcessor
        from src.utils import get_trade_date, format_number, format_time
        
        logger.success("✅ 所有模块导入成功")
        return True
    except Exception as e:
        logger.error(f"❌ 模块导入失败: {e}")
        return False


def test_utils():
    """测试工具函数"""
    logger.info("\n" + "=" * 60)
    logger.info("测试2: 工具函数")
    logger.info("=" * 60)
    
    try:
        from src.utils import (
            get_trade_date, format_number, format_time,
            parse_date, validate_date, format_stock_code
        )
        
        # 测试日期函数
        date = get_trade_date()
        logger.info(f"今日日期: {date}")
        assert len(date) == 8, "日期格式错误"
        
        # 测试日期验证
        assert validate_date("20231208") == True
        assert validate_date("2023-12-08") == False
        
        # 测试数字格式化
        assert "1.00亿" == format_number(100000000)
        assert "5000.00万" == format_number(50000000)
        
        # 测试时间格式化
        assert "09:30:00" == format_time("093000")
        assert "09:30:00" == format_time("09:30:00")
        
        # 测试股票代码格式化
        assert "000001.SZ" == format_stock_code("000001")
        assert "600000.SH" == format_stock_code("600000")
        
        logger.success("✅ 工具函数测试通过")
        return True
    except Exception as e:
        logger.error(f"❌ 工具函数测试失败: {e}")
        return False


def test_kpl_spider():
    """测试开盘啦爬虫"""
    logger.info("\n" + "=" * 60)
    logger.info("测试3: 开盘啦爬虫")
    logger.info("=" * 60)
    
    try:
        from src.kpl_spider import KPLSpider
        
        spider = KPLSpider()
        logger.info("✅ 爬虫实例创建成功")
        
        # 注意：这里只测试实例化，不实际请求数据
        # 因为接口可能需要抓包更新
        logger.info("⚠️  跳过实际数据请求测试（需要有效的API接口）")
        
        spider.close()
        logger.success("✅ 开盘啦爬虫测试通过")
        return True
    except Exception as e:
        logger.error(f"❌ 开盘啦爬虫测试失败: {e}")
        return False


def test_tushare_spider():
    """测试Tushare爬虫"""
    logger.info("\n" + "=" * 60)
    logger.info("测试4: Tushare爬虫")
    logger.info("=" * 60)
    
    try:
        from src.tushare_spider import TushareSpider
        from config import TUSHARE_TOKEN
        
        if not TUSHARE_TOKEN or TUSHARE_TOKEN == "your_tushare_token_here":
            logger.warning("⚠️  未配置Tushare Token，跳过测试")
            logger.info("请在 .env 文件中设置 TUSHARE_TOKEN")
            return True
        
        spider = TushareSpider()
        logger.info("✅ Tushare实例创建成功")
        
        # 测试获取数据
        logger.info("尝试获取今日涨停数据...")
        df = spider.get_limit_up()
        
        if df.empty:
            logger.warning("⚠️  未获取到数据（可能不是交易日）")
        else:
            logger.success(f"✅ 获取到 {len(df)} 条涨停数据")
        
        logger.success("✅ Tushare爬虫测试通过")
        return True
    except ImportError:
        logger.warning("⚠️  Tushare未安装，跳过测试")
        return True
    except Exception as e:
        logger.error(f"❌ Tushare爬虫测试失败: {e}")
        return False


def test_data_processor():
    """测试数据处理器"""
    logger.info("\n" + "=" * 60)
    logger.info("测试5: 数据处理器")
    logger.info("=" * 60)
    
    try:
        from src.data_processor import DataProcessor
        import pandas as pd
        
        processor = DataProcessor()
        logger.info("✅ 数据处理器创建成功")
        
        # 创建测试数据
        test_data = [
            {
                "ts_code": "000001.SZ",
                "name": "平安银行",
                "lu_time": "09:30:00",
                "theme": "银行",
                "status": "首板",
                "pct_chg": 10.0,
                "amount": 1000000000,
            },
            {
                "ts_code": "000002.SZ",
                "name": "万科A",
                "lu_time": "09:35:00",
                "theme": "地产",
                "status": "2连板",
                "pct_chg": 10.0,
                "amount": 800000000,
            },
        ]
        
        # 测试数据清洗
        df = processor.clean_data(test_data)
        assert len(df) == 2, "数据清洗失败"
        logger.info("✅ 数据清洗测试通过")
        
        # 测试数据排序
        sorted_df = processor.sort_data(df, by="lu_time")
        assert sorted_df.iloc[0]["lu_time"] == "09:30:00", "排序失败"
        logger.info("✅ 数据排序测试通过")
        
        # 测试数据筛选
        filtered = processor.filter_data(df, status="2连板")
        assert len(filtered) == 1, "筛选失败"
        logger.info("✅ 数据筛选测试通过")
        
        # 测试统计
        stats = processor.get_statistics(df)
        assert stats["total_count"] == 2, "统计失败"
        logger.info("✅ 数据统计测试通过")
        
        # 测试导出
        import tempfile
        import os
        
        with tempfile.TemporaryDirectory() as tmpdir:
            processor.output_dir = tmpdir
            
            # 测试CSV导出
            csv_path = processor.export_to_csv(df, "test")
            assert os.path.exists(csv_path), "CSV导出失败"
            logger.info("✅ CSV导出测试通过")
            
            # 测试Excel导出
            excel_path = processor.export_to_excel(df, "test")
            assert os.path.exists(excel_path), "Excel导出失败"
            logger.info("✅ Excel导出测试通过")
            
            # 测试JSON导出
            json_path = processor.export_to_json(df, "test")
            assert os.path.exists(json_path), "JSON导出失败"
            logger.info("✅ JSON导出测试通过")
        
        logger.success("✅ 数据处理器测试通过")
        return True
    except Exception as e:
        logger.error(f"❌ 数据处理器测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_config():
    """测试配置"""
    logger.info("\n" + "=" * 60)
    logger.info("测试6: 配置文件")
    logger.info("=" * 60)
    
    try:
        import config
        
        # 检查必要的配置
        assert hasattr(config, 'DATA_DIR'), "缺少DATA_DIR配置"
        assert hasattr(config, 'LOG_DIR'), "缺少LOG_DIR配置"
        assert hasattr(config, 'KPL_BASE_URL'), "缺少KPL_BASE_URL配置"
        assert hasattr(config, 'TUSHARE_TOKEN'), "缺少TUSHARE_TOKEN配置"
        
        logger.info(f"数据目录: {config.DATA_DIR}")
        logger.info(f"日志目录: {config.LOG_DIR}")
        logger.info(f"数据源: {config.DATA_SOURCE}")
        
        logger.success("✅ 配置文件测试通过")
        return True
    except Exception as e:
        logger.error(f"❌ 配置文件测试失败: {e}")
        return False


def run_all_tests():
    """运行所有测试"""
    logger.info("\n")
    logger.info("🚀 开始运行测试套件")
    logger.info("\n")
    
    tests = [
        ("模块导入", test_imports),
        ("工具函数", test_utils),
        ("配置文件", test_config),
        ("数据处理器", test_data_processor),
        ("开盘啦爬虫", test_kpl_spider),
        ("Tushare爬虫", test_tushare_spider),
    ]
    
    results = []
    for name, test_func in tests:
        try:
            result = test_func()
            results.append((name, result))
        except Exception as e:
            logger.error(f"测试 {name} 发生异常: {e}")
            results.append((name, False))
    
    # 汇总结果
    logger.info("\n" + "=" * 60)
    logger.info("测试结果汇总")
    logger.info("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        logger.info(f"{name}: {status}")
    
    logger.info("=" * 60)
    logger.info(f"总计: {passed}/{total} 通过")
    logger.info("=" * 60)
    
    if passed == total:
        logger.success("\n🎉 所有测试通过！")
        return True
    else:
        logger.warning(f"\n⚠️  有 {total - passed} 个测试失败")
        return False


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
