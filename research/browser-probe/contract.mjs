export function validateJob(job) {
  for (const [key, max] of [['width', 1024], ['height', 512], ['frames', 240]]) {
    if (!Number.isInteger(job[key]) || job[key] < 1 || job[key] > max) throw new Error(`Invalid ${key}`);
  }
  if (job.width * job.height * job.frames > 40_000_000) throw new Error('Pixel budget exceeded');
  return job;
}

export function delayAt(frame, frames, fps, holdMs = 0) {
  const start = Math.round(frame * 100 / fps);
  const end = Math.round((frame + 1) * 100 / fps);
  return (end - start) * 10 + (frame === frames - 1 ? Math.round(holdMs / 10) * 10 : 0);
}

export function visibleColumns(frame, frames, columns) {
  return Math.floor((frame + 1) * columns / frames);
}
