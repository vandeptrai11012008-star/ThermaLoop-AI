# ThermaLoop AI Fusion Research Digital Twin

An integrated, offline research demonstrator built from the AI.( mention if you use my project)

## Run
Open `index.html` in Chrome or Edge. No server, external dependencies, or internet required.
Website: https://thermaloop-ai-5.onrender.com

## What is improved
* Integrated A/B deterministic 60-minute comparisons with before/after 64-GPU maps and timeline charts.
* Six isolated clickable technology experiments; each changes scenarios and policy toggles.
* Synchronized 1–60 minute metric scrubbing, play-back and JSON export.
* 3D orbit/campus/data-hall camera control; 3D pipe color changes with synthetic secondary-loop water temperature.
* Serial Building → Robotics Lab → Seed Tests → Greenhouse → Return cascade.
* Physically consistent illustrative heat balance Q = m_dot * 4.186 * deltaT on that loop (not a hydraulic CFD solver).
* Primary server coolant remains a separate fluid loop; seed cold storage independently cooled.


## Research limitations
Synthetic parameters, invented device power and proxy model quality; cannot extrapolate results to real data centers. Thermal distribution uses a well-mixed single-loop equilibrium energy balance, fixed example heat-pump COP, and proportional branch load allocation with no hydraulic pressure drops, heat exchanger approach temperatures, or pump control optimization. Stage flow and return temperatures are illustrative. No direct GPU/IoT connection. Inference scheduling and fault hypotheses need calibration and benchmarking.

## Test scenarios
Standard, Winter, Burst, Summer and Cooling fault. Compare within each exact simulation seed, but policy toggles affect processing and therefore queues, heat and outcomes.
