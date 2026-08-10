# 开盘啦打板数据爬虫

🚀 一个用于获取开盘啦APP打板（涨停板）数据的Python爬虫工具。

## 功能特性

- ✅ 获取实时涨停数据
- ✅ 获取涨停历史数据
- ✅ 获取跌停数据
- ✅ 获取炸板数据
- ✅ 获取竞价数据
- ✅ 支持多种数据源（开盘啦直接接口 / Tushare API）
- ✅ 数据导出（CSV/JSON/Excel）
- ✅ 定时数据采集
- ✅ 数据可视化

## 项目结构

```
kpl/
├── README.md                 # 项目说明
├── requirements.txt          # 依赖包
├── config.py                 # 配置文件
├── src/
│   ├── __init__.py
│   ├── kpl_spider.py        # 开盘啦直接接口爬虫
│   ├── tushare_spider.py    # Tushare API 数据获取
│   ├── data_processor.py    # 数据处理模块
│   └── utils.py             # 工具函数
├── data/                     # 数据存储目录
├── logs/                     # 日志目录
└── main.py                   # 主程序入口
```

## 安装使用

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置

编辑 `config.py` 文件，设置：
- Tushare API Token（如使用Tushare数据源）
- 数据存储路径
- 其他配置项

### 3. 运行

```bash
# 获取今日涨停数据
python main.py --action today_limit

# 获取历史涨停数据
python main.py --action history --start 20231201 --end 20231208

# 获取跌停数据
python main.py --action today_down

# 获取炸板数据
python main.py --action today_break

# 导出数据到Excel
python main.py --action export --format excel
```

## 数据源说明

### 1. 开盘啦直接接口
通过抓包获取的开盘啦APP接口，可获取：
- 实时涨停
- 即将涨停
- 涨停原因
- 龙虎榜
- 竞价数据等

⚠️ **注意**：接口可能随APP更新而失效，仅供学习研究使用。

### 2. Tushare API
官方提供的稳定数据接口，需要注册账号并获取Token。
- 接口名称：`kpl_list`
- 权限要求：5000积分起

## 数据字段说明

| 字段名 | 说明 |
|--------|------|
| ts_code | 股票代码 |
| name | 股票名称 |
| trade_date | 交易日期 |
| lu_time | 涨停时间 |
| lu_desc | 涨停原因 |
| theme | 所属板块 |
| status | 连板状态 |
| net_change | 主力净额 |
| limit_order | 封单金额 |
| amount | 成交额 |
| pct_chg | 涨跌幅 |

## 法律声明

⚠️ 本工具仅供学习研究使用，请勿用于商业用途。使用本工具获取的数据请遵守相关法律法规。

## License

MIT License
