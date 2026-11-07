// Every bar item registers itself here. Add a new feature = add a folder + one line.
// Where it sits is set by each widget's `slot` (left / center / right) and `order`.
import { registerWidget } from '../core/registry';
import { audioWidget } from './audio';
import { calendarWidget } from './calendar';
import { clockWidget } from './clock';
import { mediaWidget } from './media';
import { systemWidget } from './system';
import { timersWidget } from './timers';

registerWidget(calendarWidget);
registerWidget(mediaWidget);
registerWidget(timersWidget);
registerWidget(systemWidget);
registerWidget(audioWidget);
registerWidget(clockWidget);
