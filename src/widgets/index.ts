// Every widget registers itself here. Add a new feature = add a folder + one line.
import { registerWidget } from '../core/registry';
import { audioWidget } from './audio';
import { mediaWidget } from './media';
import { systemWidget } from './system';

registerWidget(mediaWidget);
registerWidget(audioWidget);
registerWidget(systemWidget);
