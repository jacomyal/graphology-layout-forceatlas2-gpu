import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { cropToLargestConnectedComponent } from "graphology-components";
import { circlepack, random } from "graphology-layout";
import FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker";
import { SerializedGraph } from "graphology-types";
import { isNil, isNumber, mapValues } from "lodash";
import Sigma from "sigma";

import { ForceAtlas2GPU, ForceAtlas2Graph } from "../src";
import { ForceAtlas2Settings } from "../src/programs/forceAtlas2GPU/consts";
import { countStepsPerSecond } from "./fpsCounter";
import { getClustersGraph } from "./getClustersGraph";
import data from "./public/eurosis.json";

const NUMBER_KEYS = [
  "iterationsPerStep",
  "gravity",
  "scalingRatio",
  "quadTreeDepth",
  "quadTreeTheta",
  "kMeansCentroids",
  "kMeansSteps",
  "graphOrder",
  "graphSize",
  "graphClusters",
  "graphClusterDensity",
] as const;
const NUMBER_KEYS_SET = new Set<string>(NUMBER_KEYS);
type NumberKey = (typeof NUMBER_KEYS)[number];

const BOOLEAN_KEYS = [
  "strongGravityMode",
  "adjustSizes",
  "linLogMode",
  "outboundAttractionDistribution",
  "useFA2GPU",
  "useEuroSIS",
  "startRandom",
] as const;
const BOOLEAN_KEYS_SET = new Set<string>(BOOLEAN_KEYS);
type BooleanKey = (typeof BOOLEAN_KEYS)[number];

type RepulsionMode = "all-pairs" | "quad-tree" | "k-means" | "k-means-grouped";

type Params = Record<NumberKey, number> &
  Record<BooleanKey, boolean> & {
    repulsionMode: RepulsionMode;
  };

const DEFAULT_PARAMS: Params = {
  // FA2 params:
  iterationsPerStep: 100,
  gravity: 0.02,
  scalingRatio: 10,
  strongGravityMode: true,
  adjustSizes: false,
  linLogMode: false,
  outboundAttractionDistribution: false,
  useEuroSIS: false,
  useFA2GPU: true,
  startRandom: true,
  repulsionMode: "quad-tree",
  quadTreeDepth: 3,
  quadTreeTheta: 0.5,
  kMeansCentroids: 100,
  kMeansSteps: 1,
  graphOrder: 10000,
  graphSize: 50000,
  graphClusters: 5,
  graphClusterDensity: 0.7,
};

type FieldDef =
  | { type: "checkbox"; name: keyof Params; label: string; section?: boolean }
  | { type: "number"; name: keyof Params; label: string; step?: string; min?: string; section?: boolean }
  | {
      type: "select";
      name: "repulsionMode";
      label: string;
      options: { value: string; label: string }[];
      section?: boolean;
    };

const FORM_FIELDS: FieldDef[] = [
  { type: "checkbox", name: "useEuroSIS", label: "Use EuroSIS dataset" },
  { type: "number", name: "graphOrder", label: "Graph nodes", step: "1", min: "10" },
  { type: "number", name: "graphSize", label: "Graph edges", step: "1", min: "10" },
  { type: "number", name: "graphClusters", label: "Graph clusters", step: "1", min: "1" },
  { type: "number", name: "graphClusterDensity", label: "Cluster density", step: "0.01", min: "0" },
  { type: "checkbox", name: "useFA2GPU", label: "Use FA2 GPU", section: true },
  { type: "checkbox", name: "startRandom", label: "Start with random positions" },
  { type: "number", name: "iterationsPerStep", label: "Iterations per step", step: "1", min: "1" },
  { type: "number", name: "gravity", label: "Gravity", step: "0.001", min: "0" },
  { type: "number", name: "scalingRatio", label: "Scaling ratio", step: "0.1", min: "0" },
  { type: "checkbox", name: "strongGravityMode", label: "Strong gravity mode", section: true },
  { type: "checkbox", name: "adjustSizes", label: "Adjust sizes" },
  { type: "checkbox", name: "linLogMode", label: "LinLog mode" },
  { type: "checkbox", name: "outboundAttractionDistribution", label: "Outbound attraction distribution" },
  {
    type: "select",
    name: "repulsionMode",
    label: "Repulsion mode",
    section: true,
    options: [
      { value: "all-pairs", label: "All pairs (exact, slow)" },
      { value: "quad-tree", label: "Quad-tree (Barnes-Hut)" },
      { value: "k-means", label: "K-means approximation" },
      { value: "k-means-grouped", label: "K-means grouped (hybrid)" },
    ],
  },
  { type: "number", name: "quadTreeDepth", label: "Tree depth", step: "1", min: "1" },
  { type: "number", name: "quadTreeTheta", label: "Tree theta", step: "0.1", min: "0" },
  { type: "number", name: "kMeansCentroids", label: "K-means centroids", step: "1", min: "1" },
  { type: "number", name: "kMeansSteps", label: "K-means steps", step: "1", min: "1" },
];

function buildForm(form: HTMLFormElement, params: Params) {
  form.innerHTML = "";
  let currentSection: HTMLElement = form;

  FORM_FIELDS.forEach((field) => {
    if (field.section) {
      currentSection = document.createElement("div");
      currentSection.className = "form-section";
      form.appendChild(currentSection);
    }

    const group = document.createElement("div");
    group.className = field.type === "checkbox" ? "form-group checkbox" : "form-group";
    group.dataset.field = field.name;

    const label = document.createElement("label");
    label.htmlFor = field.name;
    label.textContent = field.label;

    if (field.type === "checkbox") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = field.name;
      input.id = field.name;
      input.checked = params[field.name] as boolean;
      group.append(input, label);
    } else if (field.type === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.name = field.name;
      input.id = field.name;
      input.value = String(params[field.name]);
      if (field.step) input.step = field.step;
      if (field.min) input.min = field.min;
      group.append(label, input);
    } else if (field.type === "select") {
      const select = document.createElement("select");
      select.name = field.name;
      select.id = field.name;
      field.options.forEach((opt) => {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        option.selected = opt.value === params[field.name];
        select.appendChild(option);
      });
      group.append(label, select);
    }

    currentSection.appendChild(group);
  });

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.textContent = "Apply Settings";
  form.appendChild(submitBtn);

  const updateVisibility = () => {
    const data = new FormData(form);
    const useEuroSIS = data.get("useEuroSIS") === "on";
    const mode = data.get("repulsionMode") as RepulsionMode;
    const needsTree = mode === "quad-tree";
    const needsKMeans = mode === "k-means" || mode === "k-means-grouped";

    const toggle = (name: string, show: boolean) => {
      form.querySelector(`[data-field="${name}"]`)?.classList.toggle("hidden", !show);
    };

    ["graphOrder", "graphSize", "graphClusters", "graphClusterDensity"].forEach((f) => toggle(f, !useEuroSIS));
    ["quadTreeDepth", "quadTreeTheta"].forEach((f) => toggle(f, needsTree));
    ["kMeansCentroids", "kMeansSteps"].forEach((f) => toggle(f, needsKMeans));
  };

  form.addEventListener("change", updateVisibility);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const query = new URLSearchParams();
    NUMBER_KEYS.forEach((key) => data.get(key) && query.set(key, data.get(key)!.toString()));
    BOOLEAN_KEYS.forEach((key) => query.set(key, String(data.get(key) === "on")));
    query.set("repulsionMode", data.get("repulsionMode")!.toString());
    window.location.hash = query.toString();
  });

  updateVisibility();
}

async function init() {
  const query = new URLSearchParams(window.location.hash.replace(/^[#?]+/, ""));
  const params = mapValues(DEFAULT_PARAMS, (v: boolean | number | string, k: string) => {
    const queryValue = query.get(k);

    if (k === "repulsionMode") {
      return queryValue || v;
    }

    if (NUMBER_KEYS_SET.has(k)) {
      return !isNil(queryValue) && isNumber(+queryValue) ? +queryValue : (v as number);
    }

    if (BOOLEAN_KEYS_SET.has(k)) {
      return !isNil(queryValue) ? queryValue !== "false" : !!v;
    }

    return v;
  }) as Params;

  // Build form
  const form = document.getElementById("settings-form") as HTMLFormElement;
  buildForm(form, params);

  window.addEventListener("hashchange", () => {
    window.location.reload();
  });

  let graph: Graph;
  if (params.useEuroSIS) {
    graph = Graph.from(data as unknown as SerializedGraph);
  } else {
    graph = getClustersGraph(params.graphOrder, params.graphSize, params.graphClusters, params.graphClusterDensity);
  }

  cropToLargestConnectedComponent(graph);
  louvain.assign(graph);
  if (params.startRandom) {
    random.assign(graph, {
      scale: 1000,
    });
  } else {
    circlepack.assign(graph, {
      hierarchyAttributes: ["community"],
    });
  }

  const container = document.getElementById("stage") as HTMLDivElement;
  new Sigma(graph, container, {
    itemSizesReference: "positions",
    zoomToSizeRatioFunction: (x) => x,
  });

  const getRepulsionConfig = (): ForceAtlas2Settings["repulsion"] => {
    switch (params.repulsionMode) {
      case "k-means":
        return { type: "k-means", centroids: params.kMeansCentroids, steps: params.kMeansSteps };
      case "k-means-grouped":
        return { type: "k-means-grouped", centroids: params.kMeansCentroids, steps: params.kMeansSteps };
      case "quad-tree":
        return { type: "quad-tree", depth: params.quadTreeDepth, theta: params.quadTreeTheta };
      default:
        return { type: "all-pairs" };
    }
  };

  let fa2: ForceAtlas2GPU | FA2LayoutSupervisor;
  if (params.useFA2GPU) {
    fa2 = new ForceAtlas2GPU(graph as ForceAtlas2Graph, { ...params, repulsion: getRepulsionConfig() });
  } else {
    fa2 = new FA2LayoutSupervisor(graph, { settings: { ...params, barnesHutOptimize: true } });
  }

  // Add RPS counter:
  const counter = countStepsPerSecond(graph, params.useFA2GPU ? params.iterationsPerStep : 1);
  if (counter.dom) document.body.append(counter.dom);

  // Add toggle button:
  const toggleButton = document.getElementById("toggle-fa2") as HTMLButtonElement;
  toggleButton.addEventListener("click", () => {
    if (fa2.isRunning()) {
      fa2.stop();
      counter.pause();
    } else {
      fa2.start(1000);
      counter.reset();
    }
  });

  return "FA2 was initialized properly";
}

init().then(console.log).catch(console.error);
