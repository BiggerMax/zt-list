# 🚀 快速入门指南

欢迎使用**开盘啦打板数据爬虫**！本指南将帮助你在5分钟内开始使用。

## 📋 前置要求

- Python 3.9 或更高版本
- pip 包管理器
- （可选）Tushare账号和Token

## ⚡ 快速开始（3步）

### 步骤 1: 安装依赖

```bash
cd /Users/yuanjie/work/kpl
pip install -r requirements.txt
```

### 步骤 2: 运行演示

```bash
python demo.py
```

这将展示项目的基本功能和使用方法。

### 步骤 3: 获取数据

```bash
# 使用开盘啦直接接口（无需配置）
python main.py today-limit --source kpl

# 或使用交互式菜单
./run.sh
```

## 🎯 常用命令

### 获取今日数据

```bash
# 涨停数据
python main.py today-limit

# 跌停数据
python main.py today-down

# 炸板数据
python main.py today-break
```

### 获取历史数据（需要Tushare）

```bash
# 先配置Token
cp .env.example .env
# 编辑.env文件，填入TUSHARE_TOKEN

# 获取历史数据
python main.py history --start 20231201 --end 20231208
```

### 导出不同格式

```bash
# 导出为Excel（默认）
python main.py today-limit --format excel

# 导出为CSV
python main.py today-limit --format csv

# 导出为JSON
python main.py today-limit --format json
```

## 📊 数据可视化（可选）

```bash
# 安装可视化库
pip install matplotlib seaborn

# 生成图表
python visualize.py
```

## 💻 编程使用

### 最简单的例子

```python
from src.kpl_spider import KPLSpider

# 创建爬虫
spider = KPLSpider()

# 获取今日涨停
data = spider.get_limit_up_pool()

# 查看数据
for stock in data[:5]:
    print(f"{stock['name']}: {stock['lu_time']}")

spider.close()
```

### 完整示例

```python
from src.kpl_spider import KPLSpider
from src.data_processor import DataProcessor

# 初始化
spider = KPLSpider()
processor = DataProcessor()

try:
    # 1. 获取数据
    data = spider.get_limit_up_pool()
    
    # 2. 清洗数据
    df = processor.clean_data(data)
    
    # 3. 排序（按涨停时间）
    df = processor.sort_data(df, by="lu_time")
    
    # 4. 筛选（封单>1亿）
    quality = processor.filter_data(df, limit_order__gt=100000000)
    
    # 5. 导出
    processor.export(quality, "my_stocks", format="excel")
    
    print(f"✅ 成功！找到 {len(quality)} 只高质量涨停股")
    
finally:
    spider.close()
```

## 🔧 配置Tushare（可选但推荐）

### 1. 注册账号
访问 https://tushare.pro/register 注册

### 2. 获取Token
登录后访问 https://tushare.pro/user/token

### 3. 配置Token
```bash
# 方式1: 使用.env文件
cp .env.example .env
# 编辑.env，设置 TUSHARE_TOKEN=你的token

# 方式2: 直接修改config.py
# 编辑config.py，设置 TUSHARE_TOKEN = "你的token"
```

### 4. 使用Tushare
```bash
python main.py today-limit --source tushare
```

## 📚 更多示例

运行示例脚本查看更多用法：

```bash
python examples.py
```

选择你感兴趣的示例：
1. 开盘啦直接接口示例
2. Tushare API示例
3. 数据分析示例
4. 导出格式示例

## 🆘 常见问题

### Q: 提示"未获取到数据"？
**A:** 可能原因：
- 不是交易日（周末或节假日）
- 开盘啦接口失效（需要重新抓包）
- 网络问题

**解决方案：**
- 切换到Tushare数据源
- 检查网络连接
- 查看日志文件（logs/目录）

### Q: Tushare提示Token错误？
**A:** 
1. 确认已注册并获取Token
2. 检查.env文件配置是否正确
3. 确认Token没有多余空格

### Q: 如何定时运行？
**A:** 使用crontab（macOS/Linux）：
```bash
# 每个交易日15:30运行
30 15 * * 1-5 cd /path/to/kpl && python main.py today-all
```

## 📖 深入学习

- 📄 [完整文档](USAGE.md) - 详细使用说明
- 📊 [项目总结](PROJECT_SUMMARY.md) - 功能概览
- 💡 [示例代码](examples.py) - 更多用法

## 🎉 开始使用

现在你已经准备好了！选择一个命令开始：

```bash
# 最简单的方式
./run.sh

# 或者直接获取数据
python main.py today-limit

# 或者运行示例
python examples.py
```

祝你使用愉快！📈
