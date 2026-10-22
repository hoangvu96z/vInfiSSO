export function createLatestRequestGate() {
  let latestRequest = 0;

  return {
    begin() {
      latestRequest += 1;
      return latestRequest;
    },
    isCurrent(requestId) {
      return requestId === latestRequest;
    },
    invalidate() {
      latestRequest += 1;
    },
  };
}
