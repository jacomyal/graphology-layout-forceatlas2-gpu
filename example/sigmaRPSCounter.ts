import Sigma from "sigma";

export function countSigmaRPS(sigma: Sigma) {
  let isKilled = false;
  let isPaused = false;
  let t0 = Date.now();
  let renders = 0;

  const onRender = () => {
    if (isKilled) return;
    renders++;
  };
  sigma.on("afterRender", onRender);

  const refreshDisplay = () => {
    const rps = (renders / (Date.now() - t0)) * 1000;
    dom.innerHTML = (isPaused || isNaN(rps) ? "-" : rps.toLocaleString("en-US", { maximumFractionDigits: 2 })) + " RPS";
  };

  const dom = document.createElement("div") as HTMLDivElement;
  dom.classList.add("rps-counter");
  dom.innerHTML = "- RPS";
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
      sigma.off("afterRender", onRender);
      clearInterval(intervalID);
      dom.remove();
      res.dom = null;
      isKilled = true;
    },
  };

  return res;
}
