"""
数据可视化脚本（可选）
需要额外安装: pip install matplotlib seaborn
"""
import sys
import os

# 检查是否安装了可视化库
try:
    import matplotlib.pyplot as plt
    import matplotlib
    matplotlib.use('TkAgg')  # 使用TkAgg后端
    plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'SimHei']  # 支持中文
    plt.rcParams['axes.unicode_minus'] = False  # 解决负号显示问题
except ImportError:
    print("❌ 未安装matplotlib，请运行: pip install matplotlib")
    sys.exit(1)

try:
    import seaborn as sns
    sns.set_style("whitegrid")
except ImportError:
    print("⚠️  未安装seaborn，部分图表可能不够美观")
    sns = None

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.tushare_spider import TushareSpider
from src.data_processor import DataProcessor
from loguru import logger


def plot_limit_time_distribution(df):
    """涨停时间分布图"""
    if df.empty or 'lu_time' not in df.columns:
        logger.warning("无涨停时间数据")
        return
    
    plt.figure(figsize=(12, 6))
    
    # 统计涨停时间
    time_counts = df['lu_time'].value_counts().head(15)
    
    plt.bar(range(len(time_counts)), time_counts.values, color='#FF6B6B')
    plt.xticks(range(len(time_counts)), time_counts.index, rotation=45)
    plt.xlabel('涨停时间', fontsize=12)
    plt.ylabel('数量', fontsize=12)
    plt.title('涨停时间分布 TOP15', fontsize=14, fontweight='bold')
    plt.grid(axis='y', alpha=0.3)
    
    plt.tight_layout()
    plt.savefig('data/limit_time_distribution.png', dpi=300, bbox_inches='tight')
    logger.info("✅ 涨停时间分布图已保存: data/limit_time_distribution.png")
    plt.close()


def plot_theme_distribution(df):
    """板块分布饼图"""
    if df.empty or 'theme' not in df.columns:
        logger.warning("无板块数据")
        return
    
    plt.figure(figsize=(10, 10))
    
    # 统计板块
    theme_counts = df['theme'].value_counts().head(10)
    
    colors = plt.cm.Set3(range(len(theme_counts)))
    plt.pie(theme_counts.values, labels=theme_counts.index, autopct='%1.1f%%',
            colors=colors, startangle=90)
    plt.title('热门板块分布 TOP10', fontsize=14, fontweight='bold')
    
    plt.tight_layout()
    plt.savefig('data/theme_distribution.png', dpi=300, bbox_inches='tight')
    logger.info("✅ 板块分布图已保存: data/theme_distribution.png")
    plt.close()


def plot_status_distribution(df):
    """连板分布柱状图"""
    if df.empty or 'status' not in df.columns:
        logger.warning("无连板数据")
        return
    
    plt.figure(figsize=(10, 6))
    
    # 统计连板
    status_counts = df['status'].value_counts()
    
    colors = ['#4ECDC4', '#FF6B6B', '#FFE66D', '#95E1D3', '#F38181']
    plt.barh(range(len(status_counts)), status_counts.values, 
             color=colors[:len(status_counts)])
    plt.yticks(range(len(status_counts)), status_counts.index)
    plt.xlabel('数量', fontsize=12)
    plt.ylabel('连板状态', fontsize=12)
    plt.title('连板分布统计', fontsize=14, fontweight='bold')
    plt.grid(axis='x', alpha=0.3)
    
    # 添加数值标签
    for i, v in enumerate(status_counts.values):
        plt.text(v + 0.5, i, str(v), va='center')
    
    plt.tight_layout()
    plt.savefig('data/status_distribution.png', dpi=300, bbox_inches='tight')
    logger.info("✅ 连板分布图已保存: data/status_distribution.png")
    plt.close()


def plot_amount_distribution(df):
    """成交额分布直方图"""
    if df.empty or 'amount' not in df.columns:
        logger.warning("无成交额数据")
        return
    
    plt.figure(figsize=(12, 6))
    
    # 过滤掉0值
    amounts = df[df['amount'] > 0]['amount'] / 100000000  # 转换为亿
    
    plt.hist(amounts, bins=30, color='#6C5CE7', alpha=0.7, edgecolor='black')
    plt.xlabel('成交额（亿元）', fontsize=12)
    plt.ylabel('数量', fontsize=12)
    plt.title('成交额分布', fontsize=14, fontweight='bold')
    plt.grid(axis='y', alpha=0.3)
    
    # 添加统计信息
    mean_amount = amounts.mean()
    median_amount = amounts.median()
    plt.axvline(mean_amount, color='red', linestyle='--', 
                label=f'平均值: {mean_amount:.2f}亿')
    plt.axvline(median_amount, color='green', linestyle='--', 
                label=f'中位数: {median_amount:.2f}亿')
    plt.legend()
    
    plt.tight_layout()
    plt.savefig('data/amount_distribution.png', dpi=300, bbox_inches='tight')
    logger.info("✅ 成交额分布图已保存: data/amount_distribution.png")
    plt.close()


def plot_comprehensive_dashboard(df):
    """综合仪表板"""
    if df.empty:
        logger.warning("无数据可视化")
        return
    
    fig = plt.figure(figsize=(16, 12))
    
    # 1. 涨停时间分布
    if 'lu_time' in df.columns:
        ax1 = plt.subplot(2, 2, 1)
        time_counts = df['lu_time'].value_counts().head(10)
        ax1.bar(range(len(time_counts)), time_counts.values, color='#FF6B6B')
        ax1.set_xticks(range(len(time_counts)))
        ax1.set_xticklabels(time_counts.index, rotation=45)
        ax1.set_title('涨停时间分布 TOP10', fontweight='bold')
        ax1.grid(axis='y', alpha=0.3)
    
    # 2. 板块分布
    if 'theme' in df.columns:
        ax2 = plt.subplot(2, 2, 2)
        theme_counts = df['theme'].value_counts().head(8)
        colors = plt.cm.Set3(range(len(theme_counts)))
        ax2.pie(theme_counts.values, labels=theme_counts.index, 
                autopct='%1.1f%%', colors=colors, startangle=90)
        ax2.set_title('热门板块 TOP8', fontweight='bold')
    
    # 3. 连板分布
    if 'status' in df.columns:
        ax3 = plt.subplot(2, 2, 3)
        status_counts = df['status'].value_counts()
        ax3.barh(range(len(status_counts)), status_counts.values, 
                color='#4ECDC4')
        ax3.set_yticks(range(len(status_counts)))
        ax3.set_yticklabels(status_counts.index)
        ax3.set_title('连板分布', fontweight='bold')
        ax3.grid(axis='x', alpha=0.3)
    
    # 4. 统计信息
    ax4 = plt.subplot(2, 2, 4)
    ax4.axis('off')
    
    stats_text = f"""
    数据统计摘要
    ━━━━━━━━━━━━━━━━━━━━
    
    总股票数: {len(df)}
    
    """
    
    if 'theme' in df.columns:
        stats_text += f"涉及板块: {df['theme'].nunique()}\n"
    
    if 'status' in df.columns:
        stats_text += f"连板股数: {len(df[df['status'] != '首板'])}\n"
    
    if 'amount' in df.columns:
        total_amount = df['amount'].sum() / 100000000
        stats_text += f"总成交额: {total_amount:.2f}亿\n"
        avg_amount = df['amount'].mean() / 100000000
        stats_text += f"平均成交额: {avg_amount:.2f}亿\n"
    
    ax4.text(0.1, 0.5, stats_text, fontsize=12, 
             verticalalignment='center', family='monospace',
             bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
    
    plt.suptitle('涨停数据综合分析', fontsize=16, fontweight='bold', y=0.98)
    plt.tight_layout()
    plt.savefig('data/comprehensive_dashboard.png', dpi=300, bbox_inches='tight')
    logger.info("✅ 综合仪表板已保存: data/comprehensive_dashboard.png")
    plt.close()


def main():
    """主函数"""
    logger.info("=" * 60)
    logger.info("开始生成数据可视化图表")
    logger.info("=" * 60)
    
    try:
        # 获取数据
        spider = TushareSpider()
        processor = DataProcessor()
        
        logger.info("正在获取今日涨停数据...")
        df = spider.get_limit_up()
        
        if df.empty:
            logger.warning("未获取到数据，可能不是交易日")
            return
        
        df = processor.clean_data(df)
        logger.info(f"获取到 {len(df)} 条涨停数据")
        
        # 生成图表
        logger.info("\n开始生成图表...")
        
        plot_limit_time_distribution(df)
        plot_theme_distribution(df)
        plot_status_distribution(df)
        plot_amount_distribution(df)
        plot_comprehensive_dashboard(df)
        
        logger.success("\n✅ 所有图表生成完成！")
        logger.info("图表保存在 data/ 目录下")
        
    except Exception as e:
        logger.error(f"❌ 可视化失败: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
