import Graph from "graphology";
import Sigma from "sigma";

import { ForceAtlas2GPU } from "../src/forceatlas2gpu";

async function init() {
  const res = await fetch("/les-miserables.json");
  const data = await res.json();
  const graph = new Graph();
  graph.import(data);

  const container = document.getElementById("stage") as HTMLDivElement;
  const fa2 = new ForceAtlas2GPU(graph);
  const _renderer = new Sigma(graph, container);

  const run = () => {
    fa2.run({ iterations: 1 });
    // setTimeout(run, 100);
    requestAnimationFrame(run);
  };

  run();
}

init().then(console.log).catch(console.error);
