-- Add Monge product training for the MISKA seller-learning route.
UPDATE business_kpi.seller_task_library
SET sort_order = sort_order + 1
WHERE task_type = 'SALES' AND sort_order >= 42;

INSERT INTO business_kpi.seller_task_library
  (code, task_type, title, description, expected_result, category, material_text, questions, active, sort_order)
VALUES
  ('KNOW-26', 'KNOWLEDGE', 'Monge: кошки и собаки',
   'Изучи ключевые линии Monge, реальные позиции «Миски» для кошек и собак и алгоритм безопасной консультации.',
   'Продавец различает основные линии Monge, называет реальные позиции для кошек и собак и подбирает рацион только по данным конкретной упаковки.',
   'корма',
   'Monge — итальянский бренд кормов для кошек и собак; официальным дистрибьютором в России является АО «ВАЛТА ПЕТ ПРОДАКТС». В актуальном каталоге бренда есть Daily Line, Speciality Line, BWild и ветеринарные диеты VetSolution. Утверждённый тестовый ассортимент «Миски» содержит 14 SKU Monge: 8 сухих кормов для кошек и 6 для собак; это матрица запуска, а фактическое наличие перед продажей сверяй в актуальном Min/Max/1С. При консультации сначала уточни вид животного, возраст, размер или физиологическую группу, текущий рацион и задачу, а затем сверяй назначение, состав и норму кормления конкретной упаковки. Производитель рекомендует переходить на новый рацион постепенно в течение 7 дней. При симптомах или запросе на лечебную диету продавец не ставит диагноз и не заменяет ветеринарного врача.',
   '["Какие данные о питомце нужно уточнить до выбора Monge?","Какие реальные позиции Monge для кошек и собак есть в тестовом ассортименте «Миски»?","Как объяснить переход на Monge и когда нужен ветеринарный врач?"]'::jsonb,
   true, 42)
ON CONFLICT (code) DO UPDATE SET
  task_type = EXCLUDED.task_type, title = EXCLUDED.title, description = EXCLUDED.description,
  expected_result = EXCLUDED.expected_result, category = EXCLUDED.category,
  material_text = EXCLUDED.material_text, questions = EXCLUDED.questions,
  active = EXCLUDED.active, sort_order = EXCLUDED.sort_order;
