import { useDashboardStore } from '../store'
import { backgroundImageStyle, backgroundImageUrl } from '../background'
import { applySpacing } from '../layout'
import { ButtonWidgetContent } from './widgets/ButtonWidget'

export function ViewCanvas(): React.JSX.Element {
  const widgets = useDashboardStore((s) => s.dashboard.widgets)
  const spacing = useDashboardStore((s) => s.dashboard.spacing ?? 0)
  const backgroundColor = useDashboardStore((s) => s.dashboard.backgroundColor)
  const backgroundImageVersion = useDashboardStore((s) => s.dashboard.backgroundImageVersion)
  const backgroundFit = useDashboardStore((s) => s.dashboard.backgroundFit)
  const backgroundAnchor = useDashboardStore((s) => s.dashboard.backgroundAnchor)
  const triggerWidget = useDashboardStore((s) => s.triggerWidget)
  const errors = useDashboardStore((s) => s.errors)

  return (
    <div className="view-canvas" style={{ backgroundColor }}>
      {backgroundImageVersion && (
        <div
          className="dashboard-wallpaper"
          style={{
            backgroundImage: `url(${backgroundImageUrl(backgroundImageVersion)})`,
            ...backgroundImageStyle(backgroundFit ?? 'cover', backgroundAnchor ?? 'center')
          }}
        />
      )}
      {widgets.map((widget) => {
        const rendered = applySpacing(widget.x, widget.y, widget.w, widget.h, spacing)
        return (
          <div
            key={widget.id}
            className="view-canvas__widget"
            style={{ left: rendered.x, top: rendered.y, width: rendered.w, height: rendered.h }}
          >
            <ButtonWidgetContent widget={widget} interactive onTrigger={() => triggerWidget(widget.id)} error={errors[widget.id]} />
          </div>
        )
      })}
    </div>
  )
}
