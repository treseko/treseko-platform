"""Render reviewed structured stories and criteria without changing their meaning."""

def _story_markdown(candidate):
    sections = [
        f"**Como:** {candidate.actor}" if candidate.actor else "",
        f"**Quiero:** {candidate.goal}" if candidate.goal else "",
        f"**Para:** {candidate.benefit}" if candidate.benefit else "",
    ]
    if candidate.scope:
        sections.append("**Alcance:**\n" + "\n".join(f"- {item}" for item in candidate.scope))
    if candidate.out_of_scope:
        sections.append("**Fuera de alcance:**\n" + "\n".join(f"- {item}" for item in candidate.out_of_scope))
    if candidate.dependencies:
        sections.append("**Dependencias:**\n" + "\n".join(f"- {item}" for item in candidate.dependencies))
    if candidate.risks:
        sections.append("**Riesgos:**\n" + "\n".join(f"- {item}" for item in candidate.risks))
    return "\n\n".join(filter(None, sections))


def _criteria_markdown(criteria):
    return "\n\n".join(
        f"### {item.title}\n**Dado:** {item.given}\n**Cuando:** {item.when}\n**Entonces:** " + "; ".join(item.then)
        for item in criteria
    )
