import Graph from "graphology";
import Sigma from "sigma";

import forceAtlas2GPU from "../src";
import { ForceAtlas2GPU } from "../src/forceatlas2gpu";

async function init() {
  const res = await fetch("/les-miserables.json");
  const data = await res.json();
  const graph = new Graph();
  graph.import(data);

  const container = document.getElementById("stage") as HTMLDivElement;
  const renderer = new Sigma(graph, container);
  const fa2 = new ForceAtlas2GPU(graph);

  fa2.run({ iterations: 100 });
  renderer.refresh();
}

init().then(console.log).catch(console.error);
