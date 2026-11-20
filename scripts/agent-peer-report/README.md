# AgentFootprint peer install report

`install.mjs`, called by `.github/workflows/agent-peer-report.yml`, packs the
actual checked-out Viz source and gives that archive to three fresh consumers:
default npm, strict npm and default pnpm, each with AgentFootprint 16.0.0 and
engine 14.0.0. It records versions, exact source/package digests, exit codes and
complete stdout/stderr separately. Lifecycle hooks and fetch retries are off.

Installer refusal is an observation, not a failed source gate. A spawn/transport
failure aborts the report rather than inventing a compatibility verdict. The
workflow uploads only the compact report/log files, not consumer installations.
Viz remains private: a file install of its real pack is not npm publication.
