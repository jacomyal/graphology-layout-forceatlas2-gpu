import Graph from "graphology";
import clusters from "graphology-generators/random/clusters";
import random from "graphology-layout/random";
import { isNil, isNumber, map, mapValues } from "lodash";
import Sigma from "sigma";

import { ForceAtlas2GPU, ForceAtlas2Graph } from "../src";
import { countSigmaRPS } from "./sigmaRPSCounter";

const NUMBER_KEYS = [
  "order",
  "size",
  "clusters",
  "iterationsPerStep",
  "gravity",
  "scalingRatio",
  "quadTreeDepth",
  "quadTreeTheta",
] as const;
const NUMBER_KEYS_SET = new Set<string>(NUMBER_KEYS);
type NumberKey = (typeof NUMBER_KEYS)[number];

const BOOLEAN_KEYS = [
  "strongGravityMode",
  "adjustSizes",
  "linLogMode",
  "outboundAttractionDistribution",
  "enableQuadTree",
] as const;
const BOOLEAN_KEYS_SET = new Set<string>(BOOLEAN_KEYS);
type BooleanKey = (typeof BOOLEAN_KEYS)[number];

const DEFAULT_PARAMS: Record<NumberKey, number> & Record<BooleanKey, boolean> = {
  // Graph params:
  order: 1000,
  size: 5000,
  clusters: 3,

  // FA2 params:
  iterationsPerStep: 10,
  gravity: 0.02,
  scalingRatio: 10,
  strongGravityMode: false,
  adjustSizes: false,
  linLogMode: false,
  outboundAttractionDistribution: false,
  enableQuadTree: false,
  quadTreeDepth: 3,
  quadTreeTheta: 0.5,
};

async function init() {
  const query = new URLSearchParams(window.location.hash.replace(/^[#?]+/, ""));
  const params = mapValues(DEFAULT_PARAMS, (v: boolean | number, k: string) => {
    const queryValue = query.get(k);

    if (NUMBER_KEYS_SET.has(k)) {
      return !isNil(queryValue) && isNumber(+queryValue) ? +queryValue : (v as number);
    }

    if (BOOLEAN_KEYS_SET.has(k)) {
      return !isNil(queryValue) ? queryValue !== "false" : !!v;
    }

    return v;
  }) as typeof DEFAULT_PARAMS;

  (document.querySelector(".overlay ul") as HTMLUListElement).innerHTML = map(
    params,
    (v: number, k) => `<li><strong>${k}:</strong> ${NUMBER_KEYS_SET.has(k) ? v.toLocaleString("en-US") : v}</li>`,
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
    ...params,
  });
  const sigma = new Sigma(graph, container, {
    itemSizesReference: "positions",
    zoomToSizeRatioFunction: (x) => x,
  });

  fa2.start(1000);

  // Add RPS counter:
  const counter = countSigmaRPS(sigma);
  if (counter.dom) document.body.append(counter.dom);

  // Add toggle button:
  const toggleButton = document.querySelector("button") as HTMLButtonElement;
  toggleButton.addEventListener("click", () => {
    if (fa2.isRunning()) {
      console.log("Stop FA2");
      fa2.stop();
      counter.pause();
    } else {
      console.log("Start FA2");
      fa2.start(1000);
      counter.reset();
    }
  });

  return "FA2 was initialized properly";
}

init().then(console.log).catch(console.error);
