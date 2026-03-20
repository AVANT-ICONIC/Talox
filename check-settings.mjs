import { TaloxController } from './dist/index.js';

const talox = new TaloxController('.', { observe: true });
console.log('observe:', talox.getSettings().headed, talox.getSettings().humanTakeoverEnabled);

const talox2 = new TaloxController('.', { humanTakeover: true });
console.log('humanTakeover:', talox2.getSettings().headed, talox2.getSettings().humanTakeoverEnabled);
