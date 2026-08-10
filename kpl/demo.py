#!/usr/bin/env python3
"""
快速演示脚本 - 展示爬虫基本功能
"""
import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

print("=" * 70)
print("  开盘啦打板数据爬虫 - 快速演示")
print("=" * 70)
print()

# 1. 测试基础模块
print("📦 1. 测试基础模块...")
try:
    from src.utils import get_trade_date, format_number, format_time
    print(f"   ✅ 工具模块导入成功")
    print(f"   📅 今日日期: {get_trade_date()}")
    print(f"   💰 格式化金额: {format_number(123456789)} (原值: 123456789)")
    print(f"   ⏰ 格式化时间: {format_time('093000')} (原值: 093000)")
except Exception as e:
    print(f"   ❌ 失败: {e}")

print()

# 2. 测试开盘啦爬虫
print("🕷️  2. 测试开盘啦爬虫...")
try:
    from src.kpl_spider import KPLSpider
    
    spider = KPLSpider()
    print("   ✅ 爬虫实例创建成功")
    print("   ℹ️  开盘啦直接接口已就绪")
    print("   ⚠️  注意: 实际使用需要有效的API接口（通过抓包获取）")
    spider.close()
except Exception as e:
    print(f"   ❌ 失败: {e}")

print()

# 3. 测试配置
print("⚙️  3. 测试配置...")
try:
    import config
    print(f"   ✅ 配置加载成功")
    print(f"   📁 数据目录: {config.DATA_DIR}")
    print(f"   📝 日志目录: {config.LOG_DIR}")
    print(f"   🔌 数据源: {config.DATA_SOURCE}")
    print(f"   🌐 开盘啦API: {config.KPL_BASE_URL}")
except Exception as e:
    print(f"   ❌ 失败: {e}")

print()

# 4. 检查Tushare
print("📊 4. 检查Tushare支持...")
try:
    import tushare as ts
    from config import TUSHARE_TOKEN
    
    if TUSHARE_TOKEN and TUSHARE_TOKEN != "your_tushare_token_here":
        print("   ✅ Tushare已安装且Token已配置")
        print("   ℹ️  可以使用Tushare数据源")
    else:
        print("   ⚠️  Tushare已安装但未配置Token")
        print("   💡 提示: 在.env文件中设置TUSHARE_TOKEN")
        print("   🔗 注册地址: https://tushare.pro/register")
except ImportError:
    print("   ⚠️  Tushare未安装")
    print("   💡 安装命令: pip install tushare")

print()

# 5. 项目结构
print("📂 5. 项目结构...")
print("""
   kpl/
   ├── README.md              # 项目说明
   ├── USAGE.md               # 使用指南
   ├── requirements.txt       # 依赖包
   ├── config.py              # 配置文件
   ├── main.py                # 主程序
   ├── examples.py            # 示例脚本
   ├── test.py                # 测试脚本
   ├── run.sh                 # 快速启动脚本
   ├── src/
   │   ├── kpl_spider.py      # 开盘啦爬虫
   │   ├── tushare_spider.py  # Tushare爬虫
   │   ├── data_processor.py  # 数据处理
   │   └── utils.py           # 工具函数
   ├── data/                  # 数据存储
   └── logs/                  # 日志文件
""")

print()
print("=" * 70)
print("  快速使用指南")
print("=" * 70)
print()
print("📝 命令行使用:")
print("   python main.py today-limit      # 获取今日涨停")
print("   python main.py today-down       # 获取今日跌停")
print("   python main.py today-break      # 获取今日炸板")
print("   python main.py today-all        # 获取所有数据(Tushare)")
print()
print("🚀 快速启动:")
print("   ./run.sh                        # 交互式菜单")
print()
print("📚 查看示例:")
print("   python examples.py              # 运行示例脚本")
print()
print("📖 详细文档:")
print("   cat README.md                   # 项目说明")
print("   cat USAGE.md                    # 使用指南")
print()
print("=" * 70)
print("✨ 演示完成！")
print("=" * 70)
