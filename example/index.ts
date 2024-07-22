import Graph from "graphology";
import Sigma from "sigma";

import forceAtlas2GPU from "../src";

async function init() {
  const res = await fetch("/les-miserables.json");
  const data = await res.json();
  const graph = new Graph();
  graph.import(data);

  const container = document.getElementById("stage") as HTMLDivElement;
  const renderer = new Sigma(graph, container);

  forceAtlas2GPU(graph, {});
}

init().then(console.log).catch(console.error);
