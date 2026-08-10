# 使用指南

## 快速开始

### 1. 安装依赖

```bash
# 创建虚拟环境（推荐）
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
# 或
venv\Scripts\activate  # Windows

# 安装依赖包
pip install -r requirements.txt
```

### 2. 配置

复制环境变量模板并编辑：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```bash
# 如果使用Tushare数据源，需要填入Token
TUSHARE_TOKEN=your_token_here

# 选择数据源：kpl（开盘啦直接接口）或 tushare（Tushare API）
DATA_SOURCE=kpl
```

**获取Tushare Token：**
1. 访问 https://tushare.pro/register 注册账号
2. 登录后访问 https://tushare.pro/user/token 获取Token
3. 将Token填入 `.env` 文件

### 3. 使用快速启动脚本（推荐）

```bash
./run.sh
```

脚本会自动：
- 检查Python环境
- 创建虚拟环境
- 安装依赖
- 提供交互式菜单

### 4. 使用命令行

#### 获取今日涨停数据

```bash
# 使用开盘啦接口
python main.py today-limit --source kpl

# 使用Tushare接口
python main.py today-limit --source tushare

# 导出为CSV格式
python main.py today-limit --format csv
```

#### 获取今日跌停数据

```bash
python main.py today-down
```

#### 获取今日炸板数据

```bash
python main.py today-break
```

#### 获取历史数据（仅Tushare）

```bash
# 获取2023年12月1日到12月8日的涨停数据
python main.py history --start 20231201 --end 20231208

# 获取跌停数据
python main.py history --start 20231201 --end 20231208 --tag 跌停

# 获取炸板数据
python main.py history --start 20231201 --end 20231208 --tag 炸板
```

#### 获取今日所有数据（仅Tushare）

```bash
python main.py today-all
```

## 编程使用

### 示例1：使用开盘啦直接接口

```python
from src.kpl_spider import KPLSpider
from src.data_processor import DataProcessor

# 创建爬虫实例
spider = KPLSpider()
processor = DataProcessor()

try:
    # 获取今日涨停数据
    limit_up = spider.get_limit_up_pool()
    print(f"涨停数量: {len(limit_up)}")
    
    # 获取市场情绪
    emotion = spider.get_market_emotion()
    print(f"市场情绪: {emotion}")
    
    # 获取即将涨停
    near_limit = spider.get_near_limit()
    print(f"即将涨停: {len(near_limit)}")
    
    # 数据处理
    df = processor.clean_data(limit_up)
    df = processor.sort_data(df, by="lu_time")
    
    # 导出数据
    processor.export(df, "my_data", format="excel")
    
finally:
    spider.close()
```

### 示例2：使用Tushare API

```python
from src.tushare_spider import TushareSpider
from src.data_processor import DataProcessor

# 创建爬虫实例
spider = TushareSpider()
processor = DataProcessor()

# 获取今日涨停
df = spider.get_limit_up()
print(f"涨停数量: {len(df)}")

# 获取题材数据
concepts = spider.get_kpl_concept()
print(f"题材数量: {len(concepts)}")

# 获取历史数据
history = spider.get_history_data("20231201", "20231208", tag="涨停")

# 数据分析
stats = processor.get_statistics(df)
print(f"统计信息: {stats}")

# 板块分析
theme_stats = processor.aggregate_data(
    df, 
    group_by="theme",
    agg_func={"ts_code": "count", "amount": "sum"}
)
print(theme_stats)
```

### 示例3：数据筛选和分析

```python
from src.tushare_spider import TushareSpider
from src.data_processor import DataProcessor

spider = TushareSpider()
processor = DataProcessor()

# 获取数据
df = spider.get_limit_up()
df = processor.clean_data(df)

# 筛选2连板以上
high_board = processor.filter_data(
    df, 
    status__in=["2连板", "3连板", "4连板"]
)

# 筛选高质量涨停（封单>1亿，换手率<10%）
quality = processor.filter_data(
    df,
    limit_order__gt=100000000,
    turnover_rate__lt=10
)

# 按板块统计
theme_count = processor.aggregate_data(
    df,
    group_by="theme",
    agg_func={"ts_code": "count"}
)

# 导出
processor.export(quality, "quality_limit_up", format="excel")
```

### 示例4：运行示例脚本

```bash
python examples.py
```

然后选择要运行的示例。

## 数据字段说明

### 涨停/跌停数据

| 字段 | 说明 | 示例 |
|------|------|------|
| ts_code | 股票代码 | 000001.SZ |
| name | 股票名称 | 平安银行 |
| trade_date | 交易日期 | 20231208 |
| lu_time | 涨停时间 | 09:30:00 |
| ld_time | 跌停时间 | 09:35:00 |
| open_time | 开板时间 | 10:00:00 |
| last_time | 最后涨停时间 | 14:30:00 |
| lu_desc | 涨停原因 | 人工智能+数字经济 |
| theme | 所属板块 | 人工智能 |
| status | 连板状态 | 2连板 |
| pct_chg | 涨跌幅(%) | 10.00 |
| limit_order | 封单金额(元) | 100000000 |
| amount | 成交额(元) | 500000000 |
| turnover_rate | 换手率(%) | 5.5 |
| net_change | 主力净额(元) | 50000000 |

## 数据源对比

| 特性 | 开盘啦直接接口 | Tushare API |
|------|---------------|-------------|
| 稳定性 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 数据完整性 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 实时性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 历史数据 | ❌ | ✅ |
| 需要Token | ❌ | ✅ |
| 请求限制 | 无 | 有（根据积分） |
| 维护成本 | 高（接口可能变化） | 低 |

**推荐使用场景：**
- **实时监控**：使用开盘啦直接接口
- **数据分析**：使用Tushare API
- **历史回测**：使用Tushare API

## 常见问题

### 1. Tushare Token错误

**问题**：`ValueError: 请设置Tushare Token!`

**解决**：
1. 注册Tushare账号并获取Token
2. 在 `.env` 文件中设置 `TUSHARE_TOKEN`
3. 或在 `config.py` 中直接设置

### 2. 开盘啦接口无数据

**问题**：使用开盘啦接口获取不到数据

**解决**：
1. 检查网络连接
2. 接口可能已失效，需要重新抓包获取新接口
3. 切换到Tushare数据源

### 3. 权限不足

**问题**：Tushare提示积分不足

**解决**：
1. 访问 https://tushare.pro/document/1?doc_id=13 查看积分规则
2. 完成任务获取积分
3. 或购买积分

### 4. 数据为空

**问题**：获取的数据为空

**解决**：
1. 检查是否为交易日
2. 检查日期格式是否正确（YYYYMMDD）
3. 检查该日期是否有涨停/跌停数据

## 定时任务

### 使用crontab（Linux/macOS）

```bash
# 编辑crontab
crontab -e

# 添加定时任务（每个交易日15:30执行）
30 15 * * 1-5 cd /path/to/kpl && ./venv/bin/python main.py today-all
```

### 使用Task Scheduler（Windows）

1. 打开"任务计划程序"
2. 创建基本任务
3. 设置触发器（每个工作日15:30）
4. 设置操作：运行程序 `python main.py today-all`

## 进阶功能

### 自定义数据处理

```python
from src.data_processor import DataProcessor

processor = DataProcessor()

# 自定义筛选条件
def custom_filter(df):
    # 筛选涨停时间在9:30-10:00之间的股票
    return df[df['lu_time'].between('09:30:00', '10:00:00')]

# 自定义聚合
def sector_analysis(df):
    return processor.aggregate_data(
        df,
        group_by="theme",
        agg_func={
            "ts_code": "count",
            "amount": "sum",
            "limit_order": "mean"
        }
    )
```

### 数据可视化（需要额外安装matplotlib）

```python
import matplotlib.pyplot as plt
from src.tushare_spider import TushareSpider

spider = TushareSpider()
df = spider.get_limit_up()

# 涨停时间分布
df['lu_time'].value_counts().plot(kind='bar')
plt.title('涨停时间分布')
plt.show()

# 板块分布
df['theme'].value_counts().head(10).plot(kind='pie')
plt.title('热门板块TOP10')
plt.show()
```

## 技术支持

如有问题，请查看：
- 项目README.md
- 代码注释
- examples.py示例脚本

## 免责声明

本工具仅供学习研究使用，请勿用于商业用途。使用本工具获取的数据请遵守相关法律法规和平台使用条款。投资有风险，决策需谨慎。
