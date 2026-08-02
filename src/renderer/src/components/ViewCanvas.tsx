import { useDashboardStore } from '../store'
import { ButtonWidgetContent } from './widgets/ButtonWidget'

export function ViewCanvas(): React.JSX.Element {
  const widgets = useDashboardStore((s) => s.dashboard.widgets)
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const errors = useDashboardStore((s) => s.errors)

  return (
    <div className="view-canvas">
      {widgets.map((widget) => (
        <div
          key={widget.id}
          className="view-canvas__widget"
          style={{ left: widget.x, top: widget.y, width: widget.w, height: widget.h }}
        >
          <ButtonWidgetContent widget={widget} interactive onTrigger={() => triggerWidget(widget.id)} error={errors[widget.id]} />
        </div>
      ))}
    </div>
  )
}
