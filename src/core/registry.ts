import type { WidgetDef } from './types';

const widgets = new Map<string, WidgetDef>();

export function registerWidget(def: WidgetDef) {
  widgets.set(def.id, def);
}

export function getWidgets(): WidgetDef[] {
  return [...widgets.values()].sort((a, b) => a.order - b.order);
}
