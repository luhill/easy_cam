import { useAppStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { DEFAULT_SAFE_HEIGHT, DEFAULT_TOOLPATH_RESOLUTION, DEFAULT_TRAVEL_FEED_RATE } from '../lib/toolpathConfig';
import { MAX_TOOLPATH_POINTS } from '../lib/toolpaths';
import { HintTooltip, LabelWithHint } from './HintTooltip';

export function GlobalCamSettings() {
  const safeHeight = useSettingsStore((s) => s.safeHeight);
  const toolpathResolution = useSettingsStore((s) => s.toolpathResolution);
  const travelFeedRate = useSettingsStore((s) => s.travelFeedRate);
  const setSafeHeight = useSettingsStore((s) => s.setSafeHeight);
  const setToolpathResolution = useSettingsStore((s) => s.setToolpathResolution);
  const setTravelFeedRate = useSettingsStore((s) => s.setTravelFeedRate);
  const regenerateToolpaths = useAppStore((s) => s.regenerateToolpaths);
  const toolpaths = useAppStore((s) => s.toolpaths);
  const totalPoints = toolpaths.reduce((sum, seg) => sum + seg.points.length, 0);

  return (
    <div className="global-cam-settings">
      <h3 className="panel-title">Global CAM</h3>
      <div className="settings-grid">
        <div className="setting-row">
          <label>
            <LabelWithHint hint="Used at the start and end of every operation for safe Z retract moves.">
              Safe Height
            </LabelWithHint>{' '}
            <span className="unit">(mm)</span>
          </label>
          <input
            type="number"
            value={safeHeight}
            min={0}
            max={100}
            step={1}
            onChange={(e) => {
              setSafeHeight(parseFloat(e.target.value) || DEFAULT_SAFE_HEIGHT);
              regenerateToolpaths();
            }}
          />
        </div>
        <div className="setting-row">
          <label>
            <LabelWithHint hint="1× is finest detail. 2× (default) uses half as many points. Values below 1× increase point count sharply — raise resolution if toolpaths look jagged or hit the point limit.">
              Toolpath Resolution
            </LabelWithHint>{' '}
            <span className="unit">(×)</span>
          </label>
          <input
            type="number"
            value={toolpathResolution}
            min={0.5}
            max={8}
            step={0.5}
            onChange={(e) => {
              setToolpathResolution(parseFloat(e.target.value) || DEFAULT_TOOLPATH_RESOLUTION);
              regenerateToolpaths();
            }}
          />
        </div>
        <div className="setting-row">
          <label>
            <LabelWithHint hint="Feed rate for non-cutting moves: slot return loops, retractions, and repositioning between cuts.">
              Travel Feed Rate
            </LabelWithHint>{' '}
            <span className="unit">(mm/min)</span>
          </label>
          <input
            type="number"
            value={travelFeedRate}
            min={1}
            max={10000}
            step={50}
            onChange={(e) => {
              setTravelFeedRate(parseFloat(e.target.value) || DEFAULT_TRAVEL_FEED_RATE);
              regenerateToolpaths();
            }}
          />
        </div>
      </div>
      <p className="toolpath-point-count">
        Toolpath points: {totalPoints.toLocaleString()} / {MAX_TOOLPATH_POINTS.toLocaleString()}
        <HintTooltip text="Total toolpath samples across all operations. Reduce resolution or simplify geometry if near the limit." />
      </p>
    </div>
  );
}
