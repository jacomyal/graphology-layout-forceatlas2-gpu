import Graph from "graphology";

export function countStepsPerSecond(graph: Graph, stepsPerSync: number = 1) {
  let isKilled = false;
  let isPaused = false;
  let t0 = Date.now();
  let totalSteps = 0;
  let totalRunningTime = 0; // in milliseconds
  let currentSessionSteps = 0;

  const onRender = () => {
    if (isKilled || isPaused) return;
    currentSessionSteps++;
  };
  graph.on("eachNodeAttributesUpdated", onRender);

  const refreshDisplay = () => {
    if (isPaused) {
      // When paused, show frozen values
      const avgRate = totalRunningTime > 0 ? (totalSteps / totalRunningTime) * 1000 : 0;
      dom.innerHTML = `
        <div>Total steps: ${totalSteps.toLocaleString("en-US")}</div>
        <div>Total time: ${(totalRunningTime / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })}s</div>
        <div>Avg rate: ${avgRate.toLocaleString("en-US", { maximumFractionDigits: 1 })} fa2/second</div>
      `;
    } else {
      // When running, calculate current values
      const elapsed = Date.now() - t0;
      const currentTotalSteps = totalSteps + currentSessionSteps * stepsPerSync;
      const currentTotalTime = totalRunningTime + elapsed;
      const avgRate = currentTotalTime > 0 ? (currentTotalSteps / currentTotalTime) * 1000 : 0;

      dom.innerHTML = `
        <div>Total steps: ${currentTotalSteps.toLocaleString("en-US")}</div>
        <div>Total time: ${(currentTotalTime / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })}s</div>
        <div>Avg rate: ${avgRate.toLocaleString("en-US", { maximumFractionDigits: 1 })} fa2/second</div>
      `;
    }
  };

  const dom = document.createElement("div") as HTMLDivElement;
  dom.classList.add("rps-counter");
  dom.innerHTML = `
    <div>Total steps: 0</div>
    <div>Total time: 0.00s</div>
    <div>Avg rate: 0.0 fa2/second</div>
  `;

  // Use requestAnimationFrame for smoother, more frequent updates
  let animationFrameID: number;
  const animationLoop = () => {
    if (!isKilled) {
      refreshDisplay();
      animationFrameID = requestAnimationFrame(animationLoop);
    }
  };
  animationFrameID = requestAnimationFrame(animationLoop);

  const res: { dom: HTMLElement | null; reset: () => void; pause: () => void; clean: () => void } = {
    dom,
    reset: () => {
      t0 = Date.now();
      totalSteps = 0;
      totalRunningTime = 0;
      currentSessionSteps = 0;
      isPaused = false;
      refreshDisplay();
    },
    pause: () => {
      if (!isPaused) {
        // Accumulate the current session before pausing
        const elapsed = Date.now() - t0;
        totalSteps += currentSessionSteps * stepsPerSync;
        totalRunningTime += elapsed;
        currentSessionSteps = 0;
        isPaused = true;
        refreshDisplay();
      }
    },
    clean: () => {
      if (isKilled) return;
      graph.off("eachNodeAttributesUpdated", onRender);
      cancelAnimationFrame(animationFrameID);
      dom.remove();
      res.dom = null;
      isKilled = true;
    },
  };

  return res;
}
