export const SORTIE_TEXT = Object.freeze({
  ru: Object.freeze({
    idle: "Подойди к метке и начни вылазку.",
    active: "Отбейся от мухи, затем заверши вылазку у метки.",
    complete: "Вылазка завершена. Вернись на причал или в кликер.",
    start: "Начать вылазку",
    finish: "Завершить вылазку",
  }),
  uk: Object.freeze({
    idle: "Підійди до позначки й почни вилазку.",
    active: "Відбийся від мухи, а потім заверши вилазку біля позначки.",
    complete: "Вилазку завершено. Повернися на причал або до клікера.",
    start: "Почати вилазку",
    finish: "Завершити вилазку",
  }),
  en: Object.freeze({
    idle: "Approach the marker to start the sortie.",
    active: "Fight off the fly, then finish the sortie at the marker.",
    complete: "Sortie complete. Return to the landing or the clicker.",
    start: "Start sortie",
    finish: "Finish sortie",
  }),
});

export function createSortie() {
  let state = "idle";
  let flyToken = null;

  function action(nearMarker) {
    if (nearMarker !== true) return null;
    if (state === "idle") return "start";
    if (state === "active" && flyToken === null) return "finish";
    return null;
  }

  return {
    get state() { return state; },
    action,
    interact(nearMarker) {
      switch (action(nearMarker)) {
        case "start":
          // A death callback from a cleared encounter cannot finish the next fight.
          flyToken = Symbol("sortie-fly");
          state = "active";
          return { type: "start", flyToken };
        case "finish":
          state = "complete";
          return { type: "complete" };
        default:
          return null;
      }
    },
    defeatFly(token) {
      if (flyToken === null || token !== flyToken) return false;
      flyToken = null;
      return true;
    },
    reset() {
      flyToken = null;
      state = "idle";
    },
  };
}
