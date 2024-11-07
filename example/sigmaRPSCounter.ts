import Graph from "graphology";

export function countSyncsPerSecond(graph: Graph) {
  let isKilled = false;
  let isPaused = false;
  let t0 = Date.now();
  let renders = 0;

  const onRender = () => {
    if (isKilled) return;
    renders++;
  };
  graph.on("eachNodeAttributesUpdated", onRender);

  const refreshDisplay = () => {
    const rps = (renders / (Date.now() - t0)) * 1000;
    dom.innerHTML =
      (isPaused || isNaN(rps) ? "-" : rps.toLocaleString("en-US", { maximumFractionDigits: 3 })) + " syncs/second";
  };

  const dom = document.createElement("div") as HTMLDivElement;
  dom.classList.add("rps-counter");
  dom.innerHTML = "- syncs/second";
  const intervalID = setInterval(refreshDisplay, 1000);

  const res: { dom: HTMLElement | null; reset: () => void; pause: () => void; clean: () => void } = {
    dom,
    reset: () => {
      t0 = Date.now();
      renders = 0;
      isPaused = false;
      refreshDisplay();
    },
    pause: () => {
      isPaused = true;
      refreshDisplay();
    },
    clean: () => {
      if (isKilled) return;
      graph.off("eachNodeAttributesUpdated", onRender);
      clearInterval(intervalID);
      dom.remove();
      res.dom = null;
      isKilled = true;
    },
  };

  return res;
}
