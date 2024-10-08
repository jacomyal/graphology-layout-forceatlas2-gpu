# Graphology ForceAtlas2 - GPU implementation

GPU-based JavaScript implementation of the [ForceAtlas2](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0098679) algorithm for [graphology](https://graphology.github.io).

_**Warning**: This experiment is not production ready, and is actually only visible online because I needed to put it to GitHub pages, to test it on various environments._

## Current state

Right now, I think I have a quite idiomatic WebGL implementation of ForceAtlas2. I hope to make it much faster soon, though...

It is quite a good base though, since there are various WebGL specific strategies to make the algorithm run as fast as possible, with as less CPU as possible:

- The fragment shader writes [on multiple textures](https://stackoverflow.com/questions/51793336/multiple-output-textures-from-the-same-program) at once
- The outputs and inputs of the fragment shader have the same shape, so that we can switch output and input textures between two consecutive steps, without having to iterate through the graph CPU side
- We only read CPU-side the output of the algorithm every `iterationsPerStep` steps. It is the bottleneck, though: The higher it goes, the faster the algorithm will effectively be, but the most frozen the UI will look like...

## Examples

Here are some examples:

- [Smallest graph](https://jacomyal.github.io/graphology-layout-forceatlas2-gpu/#?order=200&size=1000&iterationsPerStep=500&gravity=0.2)
- [Smally graph](https://jacomyal.github.io/graphology-layout-forceatlas2-gpu/#?order=1000&size=5000&iterationsPerStep=100&gravity=0.2)
- [Medium graph](https://jacomyal.github.io/graphology-layout-forceatlas2-gpu/#?order=5000&size=25000&iterationsPerStep=25&gravity=1)

## Reference

> Jacomy M, Venturini T, Heymann S, Bastian M (2014) ForceAtlas2, a Continuous Graph Layout Algorithm for Handy Network Visualization Designed for the Gephi Software. PLoS ONE 9(6): e98679. https://doi.org/10.1371/journal.pone.0098679
