import Graph from "graphology";
import { cropToLargestConnectedComponent } from "graphology-components";
import circular from "graphology-layout/circular";
import { isNil, isNumber, map, mapValues } from "lodash";
import Sigma from "sigma";

import { ForceAtlas2GPU, ForceAtlas2Graph } from "../src";
import data from "./public/eurosis.json";
import { countSyncsPerSecond } from "./sigmaRPSCounter";

const NUMBER_KEYS = ["iterationsPerStep", "gravity", "scalingRatio", "quadTreeDepth", "quadTreeTheta"] as const;
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
    (v: number, k: string) =>
      `<li><strong>${k}:</strong> ${NUMBER_KEYS_SET.has(k) ? v.toLocaleString("en-US") : v}</li>`,
  ).join("\n");

  window.addEventListener("hashchange", () => {
    window.location.reload();
  });

  const graph = Graph.from(data);

  cropToLargestConnectedComponent(graph);

  circular.assign(graph, {
    scale: 1000,
    center: 0,
  });

  const container = document.getElementById("stage") as HTMLDivElement;
  const fa2 = new ForceAtlas2GPU(graph as ForceAtlas2Graph, {
    ...params,
  });
  new Sigma(graph, container, {
    itemSizesReference: "positions",
    zoomToSizeRatioFunction: (x) => x,
  });

  fa2.start(1000);

  // Add RPS counter:
  const counter = countSyncsPerSecond(graph);
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
