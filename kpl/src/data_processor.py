"""
数据处理模块
负责数据清洗、转换、导出等功能
"""
import json
from pathlib import Path
from typing import List, Dict, Optional, Union
import pandas as pd
from loguru import logger
from datetime import datetime

import sys
sys.path.append('..')
from config import DATA_DIR, EXPORT_FORMATS
from .utils import format_number, format_time, Timer


class DataProcessor:
    """数据处理器"""
    
    def __init__(self, output_dir: Optional[Path] = None):
        """
        初始化数据处理器
        
        Args:
            output_dir: 输出目录
        """
        self.output_dir = output_dir or DATA_DIR
        self.output_dir.mkdir(exist_ok=True)
        logger.info(f"数据处理器初始化完成，输出目录: {self.output_dir}")
    
    def clean_data(self, data: Union[List[Dict], pd.DataFrame]) -> pd.DataFrame:
        """
        清洗数据
        
        Args:
            data: 原始数据（列表或DataFrame）
        
        Returns:
            清洗后的DataFrame
        """
        if isinstance(data, list):
            df = pd.DataFrame(data)
        else:
            df = data.copy()
        
        if df.empty:
            logger.warning("数据为空，无需清洗")
            return df
        
        # 去除重复数据
        before_count = len(df)
        df = df.drop_duplicates()
        after_count = len(df)
        
        if before_count > after_count:
            logger.info(f"去除 {before_count - after_count} 条重复数据")
        
        # 处理缺失值
        df = df.fillna({
            'lu_time': '-',
            'ld_time': '-',
            'open_time': '-',
            'lu_desc': '未知',
            'theme': '其他',
            'status': '首板',
        })
        
        # 数值类型转换
        numeric_columns = ['pct_chg', 'limit_order', 'amount', 'turnover_rate', 'net_change']
        for col in numeric_columns:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
        
        return df
    
    def sort_data(self, df: pd.DataFrame, by: str = "lu_time", ascending: bool = True) -> pd.DataFrame:
        """
        排序数据
        
        Args:
            df: DataFrame
            by: 排序字段
            ascending: 是否升序
        
        Returns:
            排序后的DataFrame
        """
        if df.empty or by not in df.columns:
            return df
        
        return df.sort_values(by=by, ascending=ascending).reset_index(drop=True)
    
    def filter_data(self, df: pd.DataFrame, **conditions) -> pd.DataFrame:
        """
        筛选数据
        
        Args:
            df: DataFrame
            **conditions: 筛选条件
        
        Returns:
            筛选后的DataFrame
        
        Examples:
            filter_data(df, status="2连板", pct_chg__gt=9.5)
        """
        if df.empty:
            return df
        
        result = df.copy()
        
        for key, value in conditions.items():
            if "__" in key:
                # 支持比较操作符
                field, op = key.split("__")
                if field not in result.columns:
                    continue
                
                if op == "gt":
                    result = result[result[field] > value]
                elif op == "gte":
                    result = result[result[field] >= value]
                elif op == "lt":
                    result = result[result[field] < value]
                elif op == "lte":
                    result = result[result[field] <= value]
                elif op == "ne":
                    result = result[result[field] != value]
                elif op == "in":
                    result = result[result[field].isin(value)]
            else:
                # 等值筛选
                if key in result.columns:
                    result = result[result[key] == value]
        
        logger.info(f"筛选后剩余 {len(result)} 条数据")
        return result
    
    def aggregate_data(self, df: pd.DataFrame, group_by: str, agg_func: Dict) -> pd.DataFrame:
        """
        聚合数据
        
        Args:
            df: DataFrame
            group_by: 分组字段
            agg_func: 聚合函数字典
        
        Returns:
            聚合后的DataFrame
        
        Examples:
            aggregate_data(df, "theme", {"ts_code": "count", "amount": "sum"})
        """
        if df.empty or group_by not in df.columns:
            return df
        
        result = df.groupby(group_by).agg(agg_func).reset_index()
        logger.info(f"按 {group_by} 分组，得到 {len(result)} 组数据")
        return result
    
    def get_statistics(self, df: pd.DataFrame) -> Dict:
        """
        获取数据统计信息
        
        Args:
            df: DataFrame
        
        Returns:
            统计信息字典
        """
        if df.empty:
            return {}
        
        stats = {
            "total_count": len(df),
            "unique_stocks": df['ts_code'].nunique() if 'ts_code' in df.columns else 0,
        }
        
        # 涨停时间分布
        if 'lu_time' in df.columns:
            time_dist = df['lu_time'].value_counts().to_dict()
            stats['time_distribution'] = time_dist
        
        # 板块分布
        if 'theme' in df.columns:
            theme_dist = df['theme'].value_counts().head(10).to_dict()
            stats['top_themes'] = theme_dist
        
        # 连板统计
        if 'status' in df.columns:
            status_dist = df['status'].value_counts().to_dict()
            stats['status_distribution'] = status_dist
        
        # 数值统计
        numeric_cols = ['pct_chg', 'amount', 'turnover_rate', 'limit_order']
        for col in numeric_cols:
            if col in df.columns:
                stats[f"{col}_mean"] = float(df[col].mean())
                stats[f"{col}_max"] = float(df[col].max())
                stats[f"{col}_min"] = float(df[col].min())
        
        return stats
    
    def export_to_csv(self, df: pd.DataFrame, filename: str) -> Path:
        """
        导出为CSV文件
        
        Args:
            df: DataFrame
            filename: 文件名
        
        Returns:
            文件路径
        """
        with Timer("导出CSV"):
            filepath = self.output_dir / f"{filename}.csv"
            df.to_csv(filepath, index=False, encoding='utf-8-sig')
            logger.info(f"数据已导出到: {filepath}")
            return filepath
    
    def export_to_excel(self, df: pd.DataFrame, filename: str, sheet_name: str = "Sheet1") -> Path:
        """
        导出为Excel文件
        
        Args:
            df: DataFrame
            filename: 文件名
            sheet_name: 工作表名称
        
        Returns:
            文件路径
        """
        with Timer("导出Excel"):
            filepath = self.output_dir / f"{filename}.xlsx"
            
            with pd.ExcelWriter(filepath, engine='openpyxl') as writer:
                df.to_excel(writer, sheet_name=sheet_name, index=False)
            
            logger.info(f"数据已导出到: {filepath}")
            return filepath
    
    def export_to_json(self, data: Union[List[Dict], pd.DataFrame], filename: str) -> Path:
        """
        导出为JSON文件
        
        Args:
            data: 数据（列表或DataFrame）
            filename: 文件名
        
        Returns:
            文件路径
        """
        with Timer("导出JSON"):
            filepath = self.output_dir / f"{filename}.json"
            
            if isinstance(data, pd.DataFrame):
                data = data.to_dict('records')
            
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            
            logger.info(f"数据已导出到: {filepath}")
            return filepath
    
    def export_multi_sheet_excel(self, data_dict: Dict[str, pd.DataFrame], filename: str) -> Path:
        """
        导出多工作表Excel文件
        
        Args:
            data_dict: 数据字典 {sheet_name: DataFrame}
            filename: 文件名
        
        Returns:
            文件路径
        """
        with Timer("导出多工作表Excel"):
            filepath = self.output_dir / f"{filename}.xlsx"
            
            with pd.ExcelWriter(filepath, engine='openpyxl') as writer:
                for sheet_name, df in data_dict.items():
                    if not df.empty:
                        df.to_excel(writer, sheet_name=sheet_name, index=False)
            
            logger.info(f"数据已导出到: {filepath} (共{len(data_dict)}个工作表)")
            return filepath
    
    def export(self, data: Union[List[Dict], pd.DataFrame], 
               filename: str, format: str = "excel") -> Path:
        """
        通用导出方法
        
        Args:
            data: 数据
            filename: 文件名
            format: 格式 (csv/excel/json)
        
        Returns:
            文件路径
        """
        if format not in EXPORT_FORMATS:
            raise ValueError(f"不支持的格式: {format}，支持的格式: {EXPORT_FORMATS}")
        
        if isinstance(data, list):
            df = pd.DataFrame(data)
        else:
            df = data
        
        if format == "csv":
            return self.export_to_csv(df, filename)
        elif format == "excel":
            return self.export_to_excel(df, filename)
        elif format == "json":
            return self.export_to_json(df, filename)
    
    def load_from_csv(self, filepath: Path) -> pd.DataFrame:
        """从CSV加载数据"""
        return pd.read_csv(filepath, encoding='utf-8-sig')
    
    def load_from_excel(self, filepath: Path, sheet_name: str = 0) -> pd.DataFrame:
        """从Excel加载数据"""
        return pd.read_excel(filepath, sheet_name=sheet_name)
    
    def load_from_json(self, filepath: Path) -> List[Dict]:
        """从JSON加载数据"""
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)


if __name__ == "__main__":
    # 测试代码
    processor = DataProcessor()
    
    # 模拟数据
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
    
    # 清洗数据
    df = processor.clean_data(test_data)
    print(df)
    
    # 获取统计信息
    stats = processor.get_statistics(df)
    print(f"\n统计信息: {stats}")
    
    # 导出数据
    processor.export(df, "test_data", format="excel")
