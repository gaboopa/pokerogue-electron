export function formatUpdateProgress(received, total) {
  return {
    percent: Math.round(received / total * 100),
    size: `${Math.round(received / 1_000_000)} / ${Math.round(total / 1_000_000)} MB`,
  };
}

export function currentUpdateStep({ received, total }) {
  return received >= total ? 1 : 0;
}
