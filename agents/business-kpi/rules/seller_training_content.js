'use strict';

const CHECKED_AT = '2026-09-22';

const SOURCES = Object.freeze({
  AWARD_CATS: Object.freeze({
    name: 'AWARD — сухие корма для кошек',
    url: 'https://awardpetfood.ru/catalog/sukhie-korma-dlya-koshek',
    checkedAt: CHECKED_AT,
  }),
  AWARD_STERILIZED_TURKEY: Object.freeze({
    name: 'AWARD Sterilized с индейкой и курицей 1,5 кг',
    url: 'https://awardpetfood.ru/product/suhoj-korm-award-sterilized-dlya-vzroslyih-sterilizovannyih-koshek-s-indejkoj-i-kuritsej-s-dobavleniem-klyukvyi-i-tsikoriya-15kg',
    checkedAt: CHECKED_AT,
  }),
  AWARD_MONO_TURKEY: Object.freeze({
    name: 'AWARD Monoprotein с индейкой 1,5 кг',
    url: 'https://awardpetfood.ru/product/suhoj-korm-award-monoprotein-dlya-vzroslyih-koshek-s-indejkoj-yablokami-i-artishokami-15kg',
    checkedAt: CHECKED_AT,
  }),
  AWARD_DIET: Object.freeze({
    name: 'AWARD — Veterinary Diet',
    url: 'https://awardpetfood.ru/diet',
    checkedAt: CHECKED_AT,
  }),
  MNYAMS_CATS: Object.freeze({
    name: 'Мнямс — товары для кошек',
    url: 'https://mnyams.ru/catalog/tovary-dlya-koshek',
    checkedAt: CHECKED_AT,
  }),
  MNYAMS_WET: Object.freeze({
    name: 'Мнямс — влажные корма для кошек',
    url: 'https://mnyams.ru/catalog/vlazhnye-korma-dlya-koshek',
    checkedAt: CHECKED_AT,
  }),
  CATS_CHOICE: Object.freeze({
    name: 'Cat’s Choice — наполнители',
    url: 'https://catschoice.ru/catalog/napolniteli',
    checkedAt: CHECKED_AT,
  }),
  CRAFTIA: Object.freeze({
    name: 'Craftia — официальный сайт',
    url: 'https://craftia.pet/',
    checkedAt: CHECKED_AT,
  }),
  CRAFTIA_ENERGY: Object.freeze({
    name: 'Craftia — актуализация энергетической ценности',
    url: 'https://craftia.pet/articles/vazhnaya-informaciya',
    checkedAt: CHECKED_AT,
  }),
  BAMBINI: Object.freeze({
    name: 'Bambini Pets — официальный сайт',
    url: 'https://bambinipets.ru/',
    checkedAt: CHECKED_AT,
  }),
  CAT_FEDOR: Object.freeze({
    name: 'Ферма кота Фёдора — официальный сайт',
    url: 'https://catfedor.ru/',
    checkedAt: CHECKED_AT,
  }),
  CAT_FEDOR_WET: Object.freeze({
    name: 'Ферма кота Фёдора — влажные корма',
    url: 'https://catfedor.ru/catalog/vlazhnye-korma-dlya-koshek',
    checkedAt: CHECKED_AT,
  }),
  PREMIUM_CAT_CARE: Object.freeze({
    name: 'Premium Pet — уход для кошек',
    url: 'https://www.premium-pet.com/catalog/dlya-koshek/ukhod-za-kozhey-i-sherstyu/',
    checkedAt: CHECKED_AT,
  }),
  PREMIUM_ALL: Object.freeze({
    name: 'Premium Pet — официальный каталог',
    url: 'https://www.premium-pet.com/catalog/',
    checkedAt: CHECKED_AT,
  }),
  PREMIUM_BASIC_WIPES: Object.freeze({
    name: 'Japan Premium Pet — салфетки для пасти, ушей и глаз',
    url: 'https://www.premium-pet.com/catalog/dlya-sobak/vlazhnye_salfetki_dlya_zhivotnykh_bazovyy_ukhod_za_pastyu_ushami_i_glazami_dlya_sobak_i_koshek/',
    checkedAt: CHECKED_AT,
  }),
  INSPECTOR: Object.freeze({
    name: 'Inspector — официальный сайт',
    url: 'https://inspector.ekoprom.org/',
    checkedAt: CHECKED_AT,
  }),
  BARS: Object.freeze({
    name: 'АВЗ — БАРС от блох и клещей',
    url: 'https://avzvet.ru/catalog/bars-ot-bloh-i-kleshchej/',
    checkedAt: CHECKED_AT,
  }),
});

const TRAINING_CONTENT = Object.freeze({
  'KNOW-01': Object.freeze({
    sources: Object.freeze([SOURCES.AWARD_STERILIZED_TURKEY, SOURCES.AWARD_CATS]),
    productExamples: Object.freeze([
      'AWARD Sterilized для взрослых стерилизованных кошек с индейкой и курицей, 1,5 кг.',
      'AWARD Sterilized для взрослых стерилизованных кошек с белой рыбой, 1,5 кг.',
    ]),
    consultationScenarios: Object.freeze([
      'Покупатель: «Кошку стерилизовали, нужен сухой корм». Уточни возраст, текущий рацион и предпочтения по вкусу; покажи 1–2 Sterilized и сравни только по официальной карточке/упаковке.',
      'Покупатель спрашивает, «лечит ли Sterilized мочекаменную болезнь». Объясни, что это повседневный рацион для стерилизованных кошек; лечебную диету подбирают по назначению ветеринара.',
    ]),
  }),
  'KNOW-02': Object.freeze({
    sources: Object.freeze([SOURCES.AWARD_MONO_TURKEY, SOURCES.AWARD_CATS]),
    productExamples: Object.freeze([
      'AWARD Monoprotein для взрослых кошек из индейки с яблоком и артишоком, 1,5 кг.',
      'AWARD Monoprotein для взрослых стерилизованных кошек из лосося со спаржей и ацеролой, 1,5 кг.',
    ]),
    consultationScenarios: Object.freeze([
      'Покупатель хочет корм «с одним белком». Покажи конкретный Monoprotein и проверь на упаковке вид животного, возраст/физиологическую группу и рецепт.',
      'Покупатель говорит «у кошки аллергия». Не ставь диагноз и не обещай лечение; объясни свойства конкретного корма и предложи согласовать рацион с ветеринаром.',
    ]),
  }),
  'KNOW-03': Object.freeze({
    sources: Object.freeze([SOURCES.AWARD_DIET]),
    productExamples: Object.freeze([
      'AWARD Veterinary Diet Gastrointestinal.',
      'AWARD Veterinary Diet Hypoallergenic.',
      'AWARD Veterinary Diet Renal.',
      'AWARD Veterinary Diet Urinary для кошек.',
      'AWARD Veterinary Diet Diabetic/Obesity и Hepatic для собак.',
    ]),
    consultationScenarios: Object.freeze([
      'Покупатель показывает назначение врача «Urinary». Найди именно нужную ветеринарную диету, сверь вид животного и упаковку; не меняй назначение врача.',
      'Покупатель описывает симптомы и просит «что-нибудь лечебное». Не выбирай Veterinary Diet самостоятельно — направь к ветеринарному врачу.',
    ]),
  }),
  'KNOW-04': Object.freeze({
    sources: Object.freeze([SOURCES.AWARD_CATS, SOURCES.MNYAMS_WET]),
    productExamples: Object.freeze([
      'Сравнение сухого AWARD с влажным полнорационным кормом того же вида/возраста.',
      'Влажный Мнямс 85 г и сухой рацион сравниваются по полнорационности, назначению и норме кормления, а не по формату упаковки.',
    ]),
  }),
  'KNOW-05': Object.freeze({
    sources: Object.freeze([SOURCES.AWARD_CATS, SOURCES.MNYAMS_CATS]),
    consultationScenarios: Object.freeze([
      'Покупатель меняет один повседневный рацион на другой: покажи схему перехода на конкретной упаковке/официальной карточке.',
      'Если животное на лечебной диете или есть выраженные симптомы — переход согласует ветеринар.',
    ]),
  }),
  'KNOW-06': Object.freeze({
    sources: Object.freeze([SOURCES.MNYAMS_CATS, SOURCES.MNYAMS_WET]),
    productExamples: Object.freeze([
      'Мнямс «На каждый день» кусочки в соусе с кроликом для стерилизованных кошек, 85 г.',
      'Мнямс «На каждый день» кусочки в соусе с лососем для стерилизованных кошек, 85 г.',
      'Мнямс «На каждый день» кусочки в соусе с уткой для домашних кошек, 85 г.',
      'Мнямс: лакомства и отдельные функциональные линии, включая Dental.',
    ]),
    consultationScenarios: Object.freeze([
      'Нужно дополнение к сухому корму: сначала уточни, нужен ли полнорационный влажный корм или лакомство; не подменяй одно другим.',
      'Для лакомства уточни вид животного, возраст/размер, задачу и норму на упаковке.',
    ]),
  }),
  'KNOW-07': Object.freeze({
    sources: Object.freeze([SOURCES.CATS_CHOICE]),
    productExamples: Object.freeze([
      'Cat’s Choice растительный комкующийся тофу 6 л / 2,5 кг: без аромата и ароматизированные варианты.',
      'Cat’s Choice древесный впитывающий наполнитель.',
    ]),
    consultationScenarios: Object.freeze([
      'Покупатель хочет перейти с древесного на тофу. Уточни тип лотка, привычки кошки, отношение к аромату и способ уборки.',
    ]),
  }),
  'KNOW-08': Object.freeze({
    sources: Object.freeze([SOURCES.CATS_CHOICE]),
    productExamples: Object.freeze([
      'Cat’s Choice тофу 6 л / 2,5 кг — растительный комкующийся.',
      'Cat’s Choice силикагелевый 5 л / 2 кг — впитывающий.',
      'Cat’s Choice древесный — впитывающий.',
    ]),
    consultationScenarios: Object.freeze([
      'Не начинай с «какой наполнитель лучший». Сначала спроси текущий тип, лоток, запах/аромат, частоту уборки и бюджет.',
    ]),
  }),
  'KNOW-09': Object.freeze({
    sources: Object.freeze([SOURCES.INSPECTOR, SOURCES.BARS]),
    productExamples: Object.freeze([
      'Inspector: отдельные формы для кошек и собак; у капель есть варианты по массе, включая Mini для самых маленьких питомцев.',
      'БАРС: инсектоакарицидные спреи отдельно для кошек и собак; вид животного и дозирование сверяются по инструкции.',
    ]),
    consultationScenarios: Object.freeze([
      'Покупатель просит «Инспектор маленькой собаке». Сначала узнай точный вес и возраст, затем выбери только ту фасовку, которая соответствует официальной инструкции.',
      'Покупатель просит спрей БАРС для кошки. Не бери собачий вариант по аналогии: вид животного, дозу, противопоказания и способ применения сверяй по инструкции.',
    ]),
  }),
  'KNOW-10': Object.freeze({
    sources: Object.freeze([SOURCES.PREMIUM_CAT_CARE, SOURCES.PREMIUM_BASIC_WIPES]),
    productExamples: Object.freeze([
      'Japan Premium Pet: влажные салфетки для базового ухода за пастью, ушами и глазами собак и кошек.',
      'Japan Premium Pet: средства ухода за глазами/ушами и кожей/шерстью — только по назначению конкретной карточки.',
    ]),
    consultationScenarios: Object.freeze([
      'Покупатель просит средство для ежедневной гигиены глаз/ушей: подбери по зоне применения и виду животного.',
      'При боли, воспалении, выделениях или другом симптоме не обещай лечение гигиеническим средством — направь к ветеринару.',
    ]),
  }),
  'KNOW-11': Object.freeze({
    sources: Object.freeze([SOURCES.PREMIUM_ALL]),
    consultationScenarios: Object.freeze([
      'Сначала уточни тип шерсти и задачу: регулярное вычёсывание, колтуны, когти, экспресс-уход; затем подбери инструмент по карточке производителя.',
    ]),
  }),
  'KNOW-12': Object.freeze({
    sources: Object.freeze([SOURCES.PREMIUM_ALL]),
    consultationScenarios: Object.freeze([
      'Для кошки, которая любит охоту, предложи подходящий формат игры, но обязательно проверь размер, мелкие детали и требование присмотра.',
    ]),
  }),
  'KNOW-13': Object.freeze({
    sources: Object.freeze([SOURCES.PREMIUM_ALL]),
    consultationScenarios: Object.freeze([
      'Для активно грызущей собаки уточни размер и интенсивность игры; не обещай «неубиваемость» игрушки.',
    ]),
  }),
  'KNOW-14': Object.freeze({
    sources: Object.freeze([SOURCES.PREMIUM_ALL]),
    consultationScenarios: Object.freeze([
      'Шлейка подбирается по меркам и таблице конкретной модели; при примерке проверь свободу движения и риск выскальзывания.',
    ]),
  }),
  'KNOW-17': Object.freeze({
    sources: Object.freeze([SOURCES.CATS_CHOICE, SOURCES.PREMIUM_ALL]),
    consultationScenarios: Object.freeze([
      'Если покупатель меняет лоток из-за разбросанного наполнителя, сначала выясни размер кошки, текущий лоток и тип наполнителя, затем предложи совместимое решение.',
    ]),
  }),
  'KNOW-18': Object.freeze({
    sources: Object.freeze([
      SOURCES.AWARD_CATS,
      SOURCES.MNYAMS_CATS,
      SOURCES.CATS_CHOICE,
      SOURCES.CRAFTIA,
      SOURCES.BAMBINI,
      SOURCES.CAT_FEDOR,
      SOURCES.PREMIUM_ALL,
    ]),
    consultationScenarios: Object.freeze([
      'Любую новинку изучаем в порядке: упаковка → официальный сайт производителя → назначение → 2–3 подтверждённых отличия → вопросы покупателю.',
    ]),
  }),
  'KNOW-19': Object.freeze({
    consultationScenarios: Object.freeze([
      'Корм: «Для кого? Какая задача? Что ест сейчас?» Затем возраст/физиологическая группа и 1–2 конкретных варианта.',
      'Наполнитель: «Какой лоток? Что используете сейчас? Что не устраивает?» Затем сравнение конкретных типов.',
      'Уход: «Для какого животного? Какая зона/задача? Что уже пробовали?» При симптомах — ветеринар.',
    ]),
  }),
  'KNOW-20': Object.freeze({
    consultationScenarios: Object.freeze([
      'Можно: объяснить официальное назначение, состав, способ применения, сравнить варианты.',
      'Нельзя: ставить диагноз, назначать лечение, менять назначение врача, гарантировать медицинский результат.',
    ]),
  }),
  'KNOW-22': Object.freeze({
    sources: Object.freeze([SOURCES.CRAFTIA, SOURCES.CRAFTIA_ENERGY]),
    productExamples: Object.freeze([
      'Craftia Harmona: конкретный рецепт выбираем по виду/возрасту и упаковке.',
      'На официальном сайте бренд заявляет свежеприготовленное мясо, отсутствие эмульгаторов, ароматизаторов, красителей и консервантов, технологию Nutribiome.',
    ]),
    consultationScenarios: Object.freeze([
      'Не говори «вся Craftia одинаковая». Сначала вид/возраст питомца, затем конкретный рецепт и актуальная энергетическая ценность/норма по упаковке.',
    ]),
  }),
  'KNOW-23': Object.freeze({
    sources: Object.freeze([SOURCES.BAMBINI]),
    productExamples: Object.freeze([
      'Bambini Pets: корма и лакомства для грызунов/кроликов и птиц.',
      'Bambini Pets: домики, гамаки, минеральные камни, сепия, наполнители и игрушки.',
      'Игрушки из люфы — проверяй вид животного, размер и ограничения конкретного артикула на упаковке.',
    ]),
    consultationScenarios: Object.freeze([
      'Перед продажей игрушки сначала уточни вид питомца: хомяк, кролик, птица и т. п.; затем размер и назначение конкретного товара.',
    ]),
  }),
  'KNOW-24': Object.freeze({
    sources: Object.freeze([SOURCES.CAT_FEDOR, SOURCES.CAT_FEDOR_WET]),
    productExamples: Object.freeze([
      'Ферма кота Фёдора: сухие и влажные корма, лакомства.',
      'Влажные корма: есть отдельные позиции для котят и взрослых кошек.',
      'Лакомства: крем-лакомства, палочки и хрустящие подушечки.',
    ]),
    consultationScenarios: Object.freeze([
      'Для котёнка не бери случайный взрослый пауч: сначала проверь возрастную маркировку конкретной позиции.',
    ]),
  }),
  'KNOW-25': Object.freeze({
    sources: Object.freeze([SOURCES.PREMIUM_CAT_CARE, SOURCES.PREMIUM_BASIC_WIPES, SOURCES.PREMIUM_ALL]),
    productExamples: Object.freeze([
      'Japan Premium Pet: салфетки для базового ухода за пастью, ушами и глазами собак и кошек.',
      'Japan Premium Pet: уход за кожей/шерстью, глазами и ушами; конкретное применение сверяется по карточке товара.',
      'В Premium Pet также представлены наполнители, груминг, игрушки, амуниция и другие японские зоотовары.',
    ]),
    consultationScenarios: Object.freeze([
      'Покупатель просит японское средство «для глаз». Уточни, нужен обычный гигиенический уход или есть симптом. При симптоме — ветеринар; при уходе — конкретная официальная карточка.',
    ]),
  }),
});

function enrichTrainingTask(task) {
  if (!task || task.taskType !== 'KNOWLEDGE') return task;
  const extra = TRAINING_CONTENT[task.code];
  if (!extra) return { ...task, sources: [], productExamples: [], consultationScenarios: [] };
  return {
    ...task,
    sources: extra.sources ? [...extra.sources] : [],
    productExamples: extra.productExamples ? [...extra.productExamples] : [],
    consultationScenarios: extra.consultationScenarios ? [...extra.consultationScenarios] : [],
  };
}

module.exports = {
  CHECKED_AT,
  SOURCES,
  TRAINING_CONTENT,
  enrichTrainingTask,
};
