import { useEffect, useRef, type MutableRefObject } from 'react';
import * as echarts from 'echarts';
import { cn } from '@/lib/utils';

export type EChartsInstance = echarts.ECharts;
export type EChartsOption = echarts.EChartsOption;

interface EChartProps {
  option: EChartsOption;
  className?: string;
  /** exposes the echarts instance (PNG export etc.) */
  instanceRef?: MutableRefObject<EChartsInstance | null>;
  /** click on a data point; receives the raw echarts event params */
  onClickPoint?: (params: {
    data?: unknown;
    name?: string;
    seriesName?: string;
    value?: unknown;
    /** index into the series data / category axis */
    dataIndex?: number;
  }) => void;
}

/**
 * Thin ref-based React wrapper around echarts:
 * - init/dispose lifecycle
 * - resize via ResizeObserver
 * - notMerge updates so options fully replace (theme flips re-render cleanly)
 */
export function EChart({ option, className, instanceRef, onClickPoint }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsInstance | null>(null);
  const clickRef = useRef(onClickPoint);
  clickRef.current = onClickPoint;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    if (instanceRef) instanceRef.current = chart;
    chart.on('click', (params) => {
      clickRef.current?.(
        params as { data?: unknown; name?: string; seriesName?: string; value?: unknown; dataIndex?: number },
      );
    });
    const ro = new ResizeObserver(() => {
      if (!chart.isDisposed()) chart.resize();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
      if (instanceRef) instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart && !chart.isDisposed()) {
      chart.setOption(option, { notMerge: true });
    }
  }, [option]);

  return <div ref={containerRef} className={cn('h-64 w-full', className)} />;
}
