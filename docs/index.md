---
layout: home
title: OWASP Threat Dragon Docs
path: /
---

> **Note:** this documentation is for the [Threat Raccoon][repo] fork of OWASP Threat Dragon, which adds a
> built-in AI assistant and native MCP control. Clone and file issues against the [fork repository][repo], not
> the upstream OWASP repo. See the fork's [README](https://github.com/RedTeamRaccoon/threat-raccoon#readme) for
> the Copilot quick-start.

## Introduction

[Threat Dragon][td] is an open-source threat modelling tool from [OWASP][owasp].
Threat Dragon provides an environment to create threat models as
data-flow diagrams, along with associated threats and remediations.
The threats threats can be categorized using STRIDE, [LINDDUN][linddun],
CIA, CIA-DIE and [PLOT4ai][plot4ai].

Threat Dragon can be run as a containerized web application or as a desktop application.

The web application can store threat model files on the local file system; in addition access can be configured for :

- GitHub
- Github Enterprise
- Google Drive
- Bitbucket
- Bitbucket Enterprise
- GitLab

The desktop application saves the threat model files locally
with installers provided for MacOS, Windows and Linux.

Threat Dragon seeks to provide:

- Simplicity - you can install and start using Threat Dragon very quickly
- Flexibility - the diagramming and threat entry allows many types of threat to be described
- Accessibility - different types of teams can benefit from Threat Dragon's simplicity and flexibility

You can find the source code for Threat Dragon on [GitHub][repo],
where you can also ask for changes or report any issues.

----

Threat Dragon: _making threat modeling less threatening_

[linddun]: https://linddun.org/
[owasp]: https://owasp.org/
[plot4ai]: https://plot4.ai/
[repo]: https://github.com/RedTeamRaccoon/threat-raccoon
[td]: https://owasp.org/www-project-threat-dragon/
