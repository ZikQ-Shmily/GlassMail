let current = null;
const listeners = new Set();
const melodies = {glass:[1046.5,1568,2093], chime:[784,987.77,1174.66,1568], pulse:[660,660,880,880], beacon:[880,440,880,440,880]};
export const soundNames = {glass:'水晶轻响', chime:'风铃', pulse:'脉冲提醒', beacon:'信标警报', custom:'自定义音频'};
const soundState = () => ({playing:!!current, name:current?.name || null, loop:current?.loop || false});
const publish = () => {const state = soundState(); listeners.forEach(callback => callback(state));};
export function onSoundState(callback) {listeners.add(callback); callback(soundState()); return () => listeners.delete(callback);}

function release(session) {
  clearTimeout(session.timer);
  if (session.audio) {
    session.audio.onended = session.audio.onerror = null;
    session.audio.pause();
    try {session.audio.currentTime = 0;} catch {}
  }
  for (const {oscillator,gain} of session.nodes) {
    oscillator.onended = null;
    try {oscillator.stop();} catch {}
    oscillator.disconnect(); gain.disconnect();
  }
  session.nodes.clear();
  if (session.context) {
    session.context.onstatechange = null;
    if (session.context.state !== 'closed') session.context.close().catch(() => {});
  }
}
function finish(session) {
  if (current !== session) return;
  current = null;
  release(session);
  publish();
}

function playMelody(session, volume) {
  if (current !== session) return;
  const context = session.context, notes = melodies[session.name], now = context.currentTime;
  notes.forEach((frequency,i) => {
    const oscillator = context.createOscillator(), gain = context.createGain();
    const node = {oscillator,gain}, time = now + i * (session.name === 'beacon' ? .25 : .16);
    session.nodes.add(node);
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0,time);
    if (volume > 0) {
      gain.gain.linearRampToValueAtTime(volume * .23,time+.015);
      gain.gain.exponentialRampToValueAtTime(volume * .0001,time+.8);
    }
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect(); gain.disconnect(); session.nodes.delete(node);
      if (current !== session || i !== notes.length - 1) return;
      if (!session.loop) {finish(session); return;}
      session.timer = setTimeout(() => {
        if (current !== session) return;
        try {playMelody(session,volume);} catch {finish(session);}
      },500);
    };
    oscillator.start(time); oscillator.stop(time+.85);
  });
}

export async function playSound(name = 'glass', volume = 65, custom = null, {loop = false} = {}) {
  stopSound();
  const customAudio = name === 'custom' && custom;
  const session = {name:customAudio ? 'custom' : Object.hasOwn(melodies,name) ? name : 'glass', loop:!!loop, nodes:new Set(), timer:null, audio:null, context:null};
  const level = Number.isFinite(Number(volume)) ? Math.max(0,Math.min(100,Number(volume))) / 100 : .65;
  current = session;
  publish();
  try {
    if (customAudio) {
      const audio = session.audio = new Audio(custom);
      audio.volume = level; audio.loop = session.loop;
      audio.onended = audio.onerror = () => finish(session);
      await audio.play();
      // A stopped/replaced play request may settle later; it must never restart audio.
      if (current !== session) {audio.pause(); try {audio.currentTime = 0;} catch {}}
      return;
    }
    const context = session.context = new AudioContext();
    context.onstatechange = () => {if (context.state === 'closed') finish(session);};
    await context.resume();
    if (current !== session) return;
    playMelody(session,level);
  } catch (error) {
    // Cancellation can reject a pending play()/resume(); do not surface it as a playback failure.
    if (current !== session) return;
    finish(session);
    throw error;
  }
}
export function stopSound() {if (current) finish(current);}
