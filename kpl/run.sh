#!/bin/bash

# 开盘啦爬虫快速启动脚本

echo "================================"
echo "  开盘啦打板数据爬虫"
echo "================================"
echo ""

# 检查Python环境
if ! command -v python3 &> /dev/null; then
    echo "❌ 未找到Python3，请先安装Python"
    exit 1
fi

echo "✅ Python环境检查通过"

# 检查虚拟环境
if [ ! -d "venv" ]; then
    echo "📦 创建虚拟环境..."
    python3 -m venv venv
fi

# 激活虚拟环境
echo "🔧 激活虚拟环境..."
source venv/bin/activate

# 安装依赖
if [ ! -f "venv/.installed" ]; then
    echo "📥 安装依赖包..."
    pip install -r requirements.txt
    touch venv/.installed
    echo "✅ 依赖安装完成"
else
    echo "✅ 依赖已安装"
fi

# 检查环境变量
if [ ! -f ".env" ]; then
    echo "⚠️  未找到.env文件，从模板创建..."
    cp .env.example .env
    echo "📝 请编辑 .env 文件，填入Tushare Token"
fi

echo ""
echo "================================"
echo "  选择操作"
echo "================================"
echo "1. 获取今日涨停数据"
echo "2. 获取今日跌停数据"
echo "3. 获取今日炸板数据"
echo "4. 获取今日所有数据"
echo "5. 获取历史数据"
echo "6. 运行示例脚本"
echo "7. 退出"
echo ""

read -p "请选择 (1-7): " choice

case $choice in
    1)
        echo "📊 获取今日涨停数据..."
        python main.py today-limit
        ;;
    2)
        echo "📊 获取今日跌停数据..."
        python main.py today-down
        ;;
    3)
        echo "📊 获取今日炸板数据..."
        python main.py today-break
        ;;
    4)
        echo "📊 获取今日所有数据..."
        python main.py today-all
        ;;
    5)
        read -p "开始日期 (YYYYMMDD): " start_date
        read -p "结束日期 (YYYYMMDD): " end_date
        echo "📊 获取历史数据..."
        python main.py history --start $start_date --end $end_date
        ;;
    6)
        echo "📚 运行示例脚本..."
        python examples.py
        ;;
    7)
        echo "👋 再见！"
        exit 0
        ;;
    *)
        echo "❌ 无效选项"
        exit 1
        ;;
esac

echo ""
echo "✅ 操作完成！"
echo "📁 数据保存在 data/ 目录"
echo "📝 日志保存在 logs/ 目录"
