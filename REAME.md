# iframe-react-integration

Этот репозиторий содержит пример интеграции React (Next.js) приложения в iframe с размещением внутри попапа сайта на Tilda.

# Документация по использованию решения iframe + Tilda

В связи с переносом разработки собственного лендинга было принято временное решение интегрировать форму создания заказа в сайт на Tilda через `iframe`.

Tilda накладывает ряд ограничений, которые необходимо учитывать. Ниже описаны ключевые особенности реализации.

## 1. Кастомные брекпоинты

Для корректной адаптивной верстки были созданы и переопределены пользовательские брекпоинты:

```css
--breakpoint-xs: 400px;
--breakpoint-sm: 444px;
--breakpoint-md: 644px;
```

Использование кастомных значений обусловлено особенностями работы Tilda: платформа масштабирует (zoom) HTML-контент, включая содержимое `iframe`. Это влияет на поведение адаптива и стандартные точки перелома.

После перехода на собственный лендинг (без использования Tilda) можно будет отказаться от этих значений и вернуться к стандартным брекпоинтам TailwindCSS.

## 2. Zoom

Tilda автоматически применяет масштабирование ко всему содержимому страницы, включая приложение, отображаемое внутри `iframe`. Это приводит к:

- искажению верстки
- некорректной работе адаптива
- расхождениям с дизайн-макетами

Чтобы компенсировать это поведение, было реализовано обратное масштабирование (zoom) внутри Next.js приложения.

Текущая логика работы:

- На мобильных устройствах масштабирование не применяется, так как отображение корректное.
- Начиная с ширины `644px` (`md`), применяется `zoom: 0.7`.

```jsx
<html lang="ru" suppressHydrationWarning className="[zoom:1] md:[zoom:0.75]">
```

Данное решение является временным и может быть упрощено или удалено после отказа от Tilda и перехода на собственный лендинг.

## 3. iframe общая логика работы

### 3.1 Style

```css
.iframe-wrapper { width:100%; height:100%; border-radius:20px; ... }
.iframe-wrapper iframe { border-radius:20px; clip-path: ... }
```

Это визуальная часть: растягивание и скругление.

Далее блок:

```css
@supports selector(.t-popup:has(.ps-popup-config));
```

Он означает: применить эти правила только если браузер поддерживает `:has()`.
Дальше все селекторы начинаются с:

```css
.t-popup: has(.ps-popup-config);
```

То есть стили включаются только для тех попапов, внутри которых есть `.ps-popup-config` (то есть именно для тарифных попапов).

Что именно он делает:

- скругляет контейнер и контент попапа
- ставит `.t-popup__container`:
  `height: 95%` (это высота окна попапа относительно вьюпорта)
  `max-width: 660px`
- скрывает стандартную кнопку закрытия Тильды
- критично: протягивает высоту до HTML-блока:
  `.t868__code-wrap { height:100% }` - ХАРДКОД t868, то есть именно popup типа t868 в Тильде!
- протягивает `height:100%` в цепочке:
  `.ps-popup-config`
  `.ps-iframe-slot`
  `.iframe-wrapper`

Итог: когда iframe-wrapper окажется внутри `.ps-iframe-slot`, у него будет “от чего” взять 100% высоты.

### 3.2 Script

Что происходит при загрузке страницы (до кликов): Срабатывает IIFE:

```js
(function () { ... })();
```

#### 3.2.1 Инициализация констант

- `NEXT_APPLICATION_ORIGIN` — разрешённый origin iframe (для postMessage)
- `ORDER_CREATE_BASE_URL` - url создания заказа
- `IFRAME_ELEMENT_ID` — id iframe
- `SOURCE_PARENT_APPLICATION`/`SOURCE_NEXT_APPLICATION` — маркеры протокола сообщений
- `IFRAME_WRAPPER_ELEMENT_ID` — id обёртки iframe
- `LAST_OPENED_POPUP_ELEMENT` — переменная памяти “какой попап был открыт последним”. Это кэш активного попапа, который используется вместо повторного DOM-поиска.

#### 3.2.2 Создаются функции

- `postMessageToIframe` — отправка сообщений в iframe
- `isPopupOpened` — проверка, открыт ли конкретный popup DOM-элемент
- `findActivePopupConfiguration` — поиск открытого попапа, внутри которого есть .ps-popup-config
- `buildIframeUrl` — строит URL Next.js с query eventId и tariffId
- `mountIframeInto` — переносит существующий iframe-wrapper в заданный слот
- `handlePopupStateChange` — основной “мозг”: реагирует на открытие/закрытие попапов
- `blockEvent` — жёстко отменяет действие/всплытие события
- `getActivePopupElement` — возвращает DOM-элемент активного попапа (если есть)

#### 3.2.3 Запускается MutationObserver

```js
var mutationObserver = new MutationObserver(function () {
  if (pendingAnimationFrame) return;

  pendingAnimationFrame = requestAnimationFrame(function () {
    pendingAnimationFrame = null;
    debouncedHandlePopupStateChange();
  });
});

mutationObserver.observe(document.body, {
  attributes: true,
  childList: true,
  subtree: true,
});

handlePopupStateChange();
```

То есть:

- наблюдатель начинает следить за изменениями DOM
- `handlePopupStateChange()` вызывается сразу один раз

Сразу после загрузки попап, как правило, закрыт → активного попапа нет. Вызывает функцию каждый раз, когда в DOM что-то меняется, а именно:

- меняются атрибуты (например class)
- добавляются/удаляются элементы
- изменения происходят где угодно в DOM (subtree)

Когда пользователь кликает на триггер открытия попапа, Тильда меняет DOM (добавляет / убирает классы, стили, состояния и так далее). Все эти действия — DOM-мутации. MutationObserver их ловит и вызывает `handlePopupStateChange`. Без данного механизма невозможно было бы отследить открытие / закрытие попапа, так как у Тильды нету события `onPopupOpen` (попап открылся).

#### 3.2.4 Как определяется “попап открыт"

Функция:

```js
function isPopupOpened(popup) {
  return (
    popup.classList.contains("t-popup_show") ||
    popup.classList.contains("t-popup-show") ||
    popup.style.display === "block"
  );
}
```

Тильда в разных режимах может все это делать. Функция же проверяет все варианты.

#### 3.2.5 Как код понимает “какой тариф открыт”

Функция :

```js
function findActivePopupConfiguration() {
  var popupElements = document.querySelectorAll(".t-popup");

  for (var index = 0; index < popupElements.length; index++) {
    var popupElement = popupElements[index];

    if (!isPopupOpened(popupElement)) {
      continue;
    }

    var popupConfigurationElement =
      popupElement.querySelector(".ps-popup-config");

    if (popupConfigurationElement) {
      return {
        popupElement: popupElement,
        popupConfigurationElement: popupConfigurationElement,
      };
    }
  }

  return null;
}
```

Алгоритмы несложный: ищем все попапы на странице, проверяем какой из них открыт, берем из него `popupConfigurationElement` который содержит id тарифа и id события и возвращаем их для iframe.

#### 3.2.6 Что происходит при клике на “Забронировать” (открытие попапа)

Тильда открывает попап по якорю. Кнопка ведёт на `#popup:embedcode1` (или 2/3 без разницы, это Юра задает ссылки):

- показывает соответствующий `.t-popup`
- меняет классы/стили в DOM
- `MutationObserver` ловит изменения DOM и вызывает `handlePopupStateChange`

#### 3.2.7 handlePopupStateChange — как работает “открытие” (самое важное)

**Находим активный попап:**

```js
var activePopupData = findActivePopupConfiguration();
```

Теперь `active` не null:

- `active.popupElement` — DOM текущего попапа
- `active.popupConfigurationElement` — `.ps-popup-config` внутри него

**Проверка “это новый попап или тот же”**

```js
if (LAST_OPENED_POPUP_ELEMENT !== activePopupData.popupElement)
```

Это важно потому что MutationObserver может дергать `onPopupStateChange` много раз подряд при одном открытии.
Тут код говорит:

- если попап уже считался открытым → ничего не делаем
- если это новый открытый попап → выполняем “инициализацию”

**Чтение параметров**

```js
var eventId =
  activePopupData.popupConfigurationElement.getAttribute("data-event-id") || "";
var tariffId =
  activePopupData.popupConfigurationElement.getAttribute("data-tariff-id") ||
  "";
```

**Выбор “слота” в попапе**

```js
var iframeContainerElement =
  activePopupData.popupConfigurationElement.querySelector(".ps-iframe-slot") ||
  activePopupData.popupConfigurationElement;
```

Если `.ps-iframe-slot` есть → переносим iframe туда, иначе переносим прямо в `.ps-popup-config`

**Перенос iframe в попап (без пересоздания)**

```js
var iframeElement = mountIframeInto(iframeContainerElement);
```

А mountIframeInto делает:

- находит `#ps-iframe-wrapper`
- если wrapper сейчас в другом месте DOM — `slot.appendChild(wrapper)`
  (DOM-узел физически переедет)
- делает `wrapper.style.display = 'block'`
- возвращает сам iframe

Важно: iframe не клонируется, не создаётся заново, это тот же объект.

**Подстановка src**

```js
iframeElement.src = buildIframeUrl(eventId, tariffId);
```

Здесь функция `buildIframeUrl` просто собирается url

#### 3.2.8 Что происходит при закрытии попапа (факт закрытия)

Когда Тильда закрывает попап, DOM снова меняется → observer вызывает `handlePopupStateChange()`.

**active = null**
Потому что открытых попапов с `.ps-popup-config` нет.

**Срабатывает ветка закрытия**

```js
if (LAST_OPENED_POPUP_ELEMENT) {
  postMessageToIframe("POPUP_CLOSED", { timestamp: Date.now() });
  LAST_OPENED_POPUP_ELEMENT = null;

  var iframeWrapperElement = document.getElementById(IFRAME_WRAPPER_ELEMENT_ID);
  if (iframeWrapperElement) {
    iframeWrapperElement.style.display = "none";
  }
}
```

То есть при закрытии:

- в Next отправляется `POPUP_CLOSED`
- wrapper скрывается, чтобы не занимал место на странице
- `LAST_OPENED_POPUP` сбрасывается

Именно это сообщение в Next приводит к reset’у:

```js
if (data.type === 'POPUP_CLOSED') {
  tariffContext.clear();
  form.reset();
  ...
}
```

Далее навешиваются слушатели событий на различные действия:

- клик по кресту
- клики по overlay
- ESC

Все это делается для того, чтобы заблокировать стандартное поведение попапа тильды (закрытие) и выполнить логику nextjs приложения по показу статуса.

### 3.3 Сообщения из Next в родителя

```js
window.addEventListener("message", function (event) {
  if (event.origin !== NEXT_APPLICATION_ORIGIN) {
    return;
  }

  var messageData = event.data || {};

  if (messageData.source !== SOURCE_NEXT_APPLICATION) {
    return;
  }

  if (messageData.type === "RELOAD_PARENT") {
    window.location.reload();
    return;
  }
});
```

если Next просит “перезагрузи” → перезагружаем страницу Тильды

### 3.4 Особенность

**Почему MutationObserver нужен, даже если “закрытие перехвачено”**
Перехват закрытия — это только попытки закрытия через UI.
А MutationObserver отслеживает факт:

- попап открылся (нужно вставить iframe + src)
- попап закрылся (нужно POPUP_CLOSED + спрятать wrapper)

- Попап может закрыться:
  каким-нибудь внутренним механизмом Тильды
  изменением состояния страницы
  программно
  и т.д.

Observer ловит все случаи.

**Почему iframe-wrapper изначально display:none**

Чтобы он:

- не занимал место на странице до открытия попапа
- не показывался где-то “внизу” вне попапа

### 3.5 Оптимизация MutationObserver

MutationObserver в Tilda может срабатывать очень часто, так как:

- при открытии попапа меняются классы
- добавляются элементы
- запускаются анимации
- происходят множественные DOM-мутации

Чтобы избежать избыточных вызовов handlePopupStateChange, используется двухуровневая защита:

- rAF batching

MutationObserver оборачивается в requestAnimationFrame.
Это гарантирует, что обработка состояния попапа выполняется не чаще одного раза за кадр.

- debounce (50ms)

Даже при длительных мутациях (анимациях) обработчик будет вызван только после стабилизации DOM.
