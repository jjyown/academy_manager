"""패널 헤더용 페이지(이미지) 단위 총점 — grader.py와 동일한 배점 공식."""


def panel_scores_from_items(items: list[dict]) -> tuple[float, float]:
    """해당 이미지에 속한 문항만으로 total_score / max_score(100) 근사."""
    if not items:
        return 0.0, 100.0

    gradable = [it for it in items if it.get("correct_answer")]
    essay_total = 0.0
    essay_earned = 0.0

    for it in gradable:
        if it.get("question_type") == "essay":
            mx = float(it.get("ai_max_score") or 0)
            essay_total += mx if mx > 0 else 10.0

    mc_questions = sum(
        1
        for it in gradable
        if (it.get("question_type") or "multiple_choice") in ("multiple_choice", "short_answer", "mc", "short")
    )
    mc_per = (100.0 - essay_total) / mc_questions if mc_questions > 0 else 0.0

    mc_earned = sum(
        mc_per
        for it in gradable
        if (it.get("question_type") or "multiple_choice") in ("multiple_choice", "short_answer", "mc", "short")
        and it.get("is_correct") is True
    )

    for it in gradable:
        if it.get("question_type") == "essay":
            essay_earned += float(it.get("ai_score") or 0)

    return round(mc_earned + essay_earned, 1), 100.0
