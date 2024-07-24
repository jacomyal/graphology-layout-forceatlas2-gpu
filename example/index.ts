import Graph from "graphology";
import Sigma from "sigma";

import { ForceAtlas2GPU } from "../src/forceatlas2gpu";

async function init() {
  const res = await fetch("/les-miserables.json");
  const data = await res.json();
  const graph = new Graph();
  graph.import(data);

  const container = document.getElementById("stage") as HTMLDivElement;
  const fa2 = new ForceAtlas2GPU(graph, {
    gravity: 0.05,
    scalingRatio: 10,
    slowDown: 1 + Math.log(graph.order),
    strongGravityMode: true,
  });
  const _renderer = new Sigma(graph, container);

  fa2.start({ iterationsPerStep: 1 });
}

init().then(console.log).catch(console.error);
