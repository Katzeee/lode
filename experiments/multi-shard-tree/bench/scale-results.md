# scale-results — Tier 2 scale + complexity

_one fresh child process per scenario (WASM arena isolation), 2026-06-26_

| scenario   | args     | result | detail                                                                                                                                                                     |
| ---------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| single     | 10000    | ✅     | {"n":10000,"nodes":10001}                                                                                                                                                  |
| multi      | 10000 2  | ✅     | {"perReplica":10000,"replicas":2,"live":20001}                                                                                                                             |
| refdensity | 500 1000 | ✅     | {"nodes":500,"refsPerReplica":1000}                                                                                                                                        |
| partition  | 1000     | ✅     | {"ops":1000}                                                                                                                                                               |
| complexity | —        | ✅     | {"NS":"1000/5000/10000/50000","sizeRatio":50,"buildSlope":29.294754926782797,"snapSlope":36.486245544716034,"delPerNodeMs":"8.0→46.7→105.2→611.8","sweepMs":"5→47→53→361"} |
