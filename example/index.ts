import Graph from "graphology";
import clusters from "graphology-generators/random/clusters";
import random from "graphology-layout/random";
import { isNil, isNumber, map, mapValues } from "lodash";
import Sigma from "sigma";

import { ForceAtlas2GPU, ForceAtlas2Graph } from "../src";

const DEFAULT_PARAMS = {
  // Graph params:
  order: 1000,
  size: 5000,
  clusters: 3,

  // FA2 params:
  iterationsPerStep: 10,
  gravity: 0.02,
  scalingRatio: 10,
};

async function init() {
  const query = new URLSearchParams(window.location.hash.replace(/^[#?]+/, ""));
  const params = mapValues(DEFAULT_PARAMS, (v, k) => {
    const queryValue = query.get(k);
    if (!isNil(queryValue) && isNumber(+queryValue)) return +queryValue;
    return v;
  });

  (document.querySelector(".overlay ul") as HTMLUListElement).innerHTML = map(
    params,
    (v: number, k) => `<li><strong>${k}:</strong> ${v.toLocaleString("en-US")}</li>`,
  ).join("\n");

  window.addEventListener("hashchange", () => {
    window.location.reload();
  });

  const graph = clusters(Graph, params);
  random.assign(graph, {
    scale: 1000,
    center: 0,
  });
  const colors: Record<string, string> = {};
  for (let i = 0; i < params.clusters; i++) {
    colors[i] = "#" + Math.floor(Math.random() * 16777215).toString(16);
  }
  let i = 0;
  graph.forEachNode((node, { cluster }) => {
    graph.mergeNodeAttributes(node, {
      size: graph.degree(node) / 3,
      label: `Node n°${++i}, in cluster n°${cluster}`,
      color: colors[cluster + ""],
    });
  });

  const container = document.getElementById("stage") as HTMLDivElement;
  const fa2 = new ForceAtlas2GPU(graph as ForceAtlas2Graph, {
    slowDown: 1 + Math.log(graph.order),
    strongGravityMode: true,
    // adjustSizes: true,
    // linLogMode: true,
    // outboundAttractionDistribution: true,
    ...params,
  });
  new Sigma(graph, container, {
    itemSizesReference: "positions",
    zoomToSizeRatioFunction: (x) => x,
  });

  fa2.start(1000);

  return "FA2 was initialized properly";
}

init().then(console.log).catch(console.error);
