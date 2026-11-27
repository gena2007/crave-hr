/**
 * page-shoping.js
 * ------------------------------------------------------------
 * 落地页商品公共控制器（jQuery + Swiper）
 *
 * 功能类名接口：
 * JS 只绑定 js-* 前缀的功能类，避免和样式类、其他页面脚本冲突。
 * sp-* 只允许继续作为视觉样式类存在，不再作为 JS 功能钩子使用。
 *
 * .js-add-cart              任意加入购物车按钮
 * .js-buy-now               任意立即购买按钮
 * .js-reduce                任意数量减按钮
 * .js-calcNumber            任意数量输入框
 * .js-add                   任意数量加按钮
 * .js-opt-group             产品变体组，必须提供 data-option-index
 * .js-option                变体值，必须提供 data-val
 * .js-variant-select        下拉式变体组，必须提供 data-option-index
 * .js-cardNum               任意购物车数量显示位置
 * .js-bind-price            任意当前价格显示位置
 * .js-bind-compare          任意原价显示位置
 * .js-bind-discount-percent 当前变体折扣百分比
 * .js-bind-save-amount      当前变体相对原价节省的金额
 * .js-bind-title            任意产品标题显示位置
 * .js-bind-image            任意当前变体图片
 * .js-cart                  任意购物车入口，点击打开购物车抽屉
 * .js-header-menu-btn / data-header-menu              头部菜单按钮，点击打开菜单抽屉添加is-open类进行控制显示
 * .js-lazy-image            图片懒加载，真实地址使用 data-src；响应式图片使用 data-srcset
 * .js-lazy-video            视频懒加载，真实地址使用 data-src；提前600px加载、可见35%播放、离开暂停

 * ------------------------------------------------------------
 */
(function ($, window, document) {
    "use strict";
  
    if (!$) {
      console.error("[page-shoping] jQuery is required.");
      return;
    }
  
    var $document = $(document);
    var productVariants = $.isArray(window.product) ? window.product : [];
    var productOptions = $.isArray(window.options) ? window.options : [];
    var moneyFormat = window.shopMoneyFormat || "${{amount}}";
    var activeCurrencyCode = String(window.spCurrencyCode || "");
    var activeLocale = String(window.spLocale || document.documentElement.lang || "hr");
    var selectedVariantId = String(window.spSelectedVariantId || "");
    var lazyImageObserver = null;
    var lazyVideoLoadObserver = null;
    var lazyVideoPlayObserver = null;
    var pcMainImageLoadToken = 0;
    var pcMainImageLoadTimer = null;
    var pcMainImageCache = Object.create(null);
  
    /** 页面所有商品模块共享的唯一状态。 */
    var state = {
      variant: null,
      selectedOptions: [],
      quantity: 1,
      cartCount: Number(window.cartCount) || 0,
      galleryIndex: 0,
      gallerySwiper: null,
      thumbsSwiper: null,
      adding: false,
      buying: false,
      drawerLoading: false,
      cartLoaded: false,
      noteSaving: false,
      hasUserSelectedOptions: false
    };
  
    /** 返回 Shopify 当前语言目录，兼容 /、/en/、/de/ 等站点路径。 */
    function getShopRoot() {
      var root = window.Shopify && window.Shopify.routes && window.Shopify.routes.root;
      return root || "/";
    }
  
    /** 根据当前语言目录生成 Shopify Ajax API 地址。 */
    function getEndpoint(path) {
      return getShopRoot().replace(/\/?$/, "/") + String(path || "").replace(/^\//, "");
    }
  
    /** 把任意数量整理到 1～200，避免负数、空值和超大数量。 */
    function normalizeQuantity(value) {
      var quantity = parseInt(value, 10);
      if (isNaN(quantity)) quantity = 1;
      return Math.max(1, Math.min(200, quantity));
    }
  
    /** 按 Shopify 金额占位符添加千位分隔符。 */
    function formatMoneyNumber(cents, precision, thousands, decimal) {
      var amount = (Number(cents) || 0) / 100;
      var fixed = amount.toFixed(precision).split(".");
      fixed[0] = fixed[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return fixed[0] + (precision ? decimal + fixed[1] : "");
    }
  
    /** 使用 Shopify 当前市场的 money_format 格式化以最小货币单位保存的金额。 */
    function formatMoneyAmount(cents) {
      var value = Number(cents) || 0;
  
      if (window.Shopify && typeof window.Shopify.formatMoney === "function") {
        return window.Shopify.formatMoney(value, moneyFormat);
      }
  
      var formats = {
        amount: [2, ",", "."],
        amount_no_decimals: [0, ",", "."],
        amount_with_comma_separator: [2, ".", ","],
        amount_no_decimals_with_comma_separator: [0, ".", ","],
        amount_with_space_separator: [2, " ", ","],
        amount_no_decimals_with_space_separator: [0, " ", ","],
        amount_with_period_and_space_separator: [2, " ", "."],
        amount_with_apostrophe_separator: [2, "'", "."]
      };
  
      var formattedMoney = String(moneyFormat).replace(/\{\{\s*(\w+)\s*\}\}/g, function (match, placeholder) {
        var settings = formats[placeholder];
        if (!settings) return match;
        return formatMoneyNumber(value, settings[0], settings[1], settings[2]);
      });
  
      if (formattedMoney.indexOf("{{") === -1) return formattedMoney;
      if (window.Intl && activeCurrencyCode) {
        try {
          return new Intl.NumberFormat(activeLocale, { style: "currency", currency: activeCurrencyCode }).format(value / 100);
        } catch (error) {}
      }
      return formatMoneyNumber(value, 2, ",", ".");
    }
  
    /** Append the active market currency code once to every formatted price. */
    function formatMoney(cents) {
      var amount = String(formatMoneyAmount(cents));
      var code = activeCurrencyCode.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) return amount;
      var codePattern = new RegExp('(^|[^A-Z])' + code + '([^A-Z]|$)', 'i');
      return codePattern.test(amount) ? amount : amount + ' ' + code;
    }

    /** 统一读取变体的选项数组，兼容 Shopify JSON 的两种字段结构。 */
    function getVariantOptions(variant) {
      if (!variant) return [];
      if ($.isArray(variant.options)) return variant.options.map(String);
  
      return [variant.option1, variant.option2, variant.option3]
        .filter(function (value) { return value !== null && typeof value !== "undefined"; })
        .map(String);
    }
  
    /** 根据变体 ID 查找商品变体。 */
    function findVariantById(id) {
      var targetId = String(id || "");
      return productVariants.find(function (variant) {
        return String(variant.id) === targetId;
      }) || null;
    }
  
    /** 根据完整的选项组合查找准确变体，不允许错误回退到第一个变体。 */
    function findVariantByOptions(options) {
      return productVariants.find(function (variant) {
        var variantOptions = getVariantOptions(variant);
        if (variantOptions.length !== options.length) return false;
  
        return variantOptions.every(function (value, index) {
          return String(value) === String(options[index]);
        });
      }) || null;
    }
  
    /** 查找包含某个选项值的可售变体，用于自动修正不存在的选项组合。 */
    function findAvailableVariantForOption(optionIndex, optionValue) {
      return productVariants.find(function (variant) {
        var values = getVariantOptions(variant);
        return variant.available !== false && String(values[optionIndex]) === String(optionValue);
      }) || null;
    }
  
    /** 判断一个选项值是否至少存在于一个可售变体中。 */
    function isOptionValueAvailable(optionIndex, optionValue) {
      return !!findAvailableVariantForOption(optionIndex, optionValue);
    }
  
    /** 获取变体主图 URL，兼容 featured_image 对象和 featured_image 字符串。 */
    function getVariantImage(variant) {
      if (!variant || !variant.featured_image) return "";
      if (typeof variant.featured_image === "string") return variant.featured_image;
      return variant.featured_image.src || variant.featured_image.url || "";
    }
  
    /** 获取变体主图 ID，用 ID 关联轮播比对 URL 更准确。 */
    function getVariantImageId(variant) {
      if (!variant || !variant.featured_image || typeof variant.featured_image === "string") return "";
      return String(variant.featured_image.id || "");
    }
  
    /** 同步所有模块中的数量输入框，保证产品区和固定底栏数值一致。 */
    function renderQuantity() {
      $(".js-calcNumber").val(state.quantity);
    }
  
    /** 同步页面所有购物车角标；数量为 0 时保留 0 但使用灰色状态。 */
    function renderCartCount(count) {
      state.cartCount = Math.max(0, Number(count) || 0);
      window.cartCount = state.cartCount;
  
      $(".js-cardNum").each(function () {
        $(this)
          .text(state.cartCount)
          .toggleClass("sp-gray", state.cartCount < 1)
          .attr("aria-label", state.cartCount + " stavke u košarici");
      });
    }
  
    /** 同步按钮式和下拉式变体控件，并标记全局售罄选项。 */
    function renderVariantControls() {
      $(".js-opt-group").each(function () {
        var $group = $(this);
        var optionIndex = Number($group.attr("data-option-index"));
        var selectedValue = state.hasUserSelectedOptions ? state.selectedOptions[optionIndex] : "";
  
        $("[data-sp-option-current='" + optionIndex + "']").text(selectedValue || "");
  
        $group.find(".js-option").each(function () {
          var $option = $(this);
          var value = String($option.attr("data-val") || "");
          var available = isOptionValueAvailable(optionIndex, value);
  
          $option
            .toggleClass("active", value === String(selectedValue))
            .toggleClass("is-disabled", !available)
            .attr("aria-pressed", value === String(selectedValue) ? "true" : "false")
            .attr("aria-disabled", available ? "false" : "true");
        });
      });
  
      $(".js-variant-select").each(function () {
        var $select = $(this);
        var optionIndex = Number($select.attr("data-option-index"));
        $select.val(state.hasUserSelectedOptions ? state.selectedOptions[optionIndex] : "");
  
        $select.find("option").each(function () {
          if (String(this.value || "") === "") {
            $(this).prop("disabled", false);
            return;
          }

          var available = isOptionValueAvailable(optionIndex, this.value);
          $(this).prop("disabled", !available);
        });
      });
    }
  
    /** 同步价格、原价、折扣、标题和所有可绑定产品图片。 */
    function renderProductInformation() {
      var variant = state.variant || productVariants[0] || null;
      if (!variant) return;
  
      var price = Number(variant.price) || 0;
      var compare = Number(variant.compare_at_price) || 0;
      var totalPrice = price * state.quantity;
      var totalCompare = compare * state.quantity;
      var hasCompare = compare > price;
      var discount = hasCompare ? Math.ceil((compare - price) * 100 / compare) : 0;
      var savedAmount = hasCompare ? (compare - price) * state.quantity : 0;
      var imageUrl = getVariantImage(variant);
  
      $(".js-bind-price").text(formatMoney(totalPrice));
      $(".js-bind-compare")
        .text(formatMoney(hasCompare ? totalCompare : totalPrice))
        .toggleClass("is-hidden", !hasCompare);
      $(".js-bind-discount, .js-bind-discount-percent").text(discount + "%");
      $(".js-bind-save-amount").text(formatMoney(savedAmount));
  
      if (variant.name || window.spProductTitle) {
        $(".js-bind-title").text(window.spProductTitle || variant.name);
      }
  
      if (imageUrl) {
        $(".js-bind-image").each(function () {
          var currentUrl = this.currentSrc || $(this).attr("src") || "";
          try {
            currentUrl = new window.URL(currentUrl, window.location.href).href;
            imageUrl = new window.URL(imageUrl, window.location.href).href;
          } catch (error) {}
          if (currentUrl !== imageUrl) $(this).attr("src", imageUrl);
        });
      }
    }
  
    /** 根据当前变体可售状态统一启用或禁用所有购买按钮。 */
    function renderPurchaseButtons() {
      var purchasable = !!(state.variant && state.variant.available !== false);
  
      $(".js-add-cart, .js-buy-now")
        .toggleClass("is-disabled", !purchasable)
        .attr("aria-disabled", purchasable ? "false" : "true");
    }

    /** Keep visible controls aligned with the actual variant after adding to cart or clearing a select. */
    function resetFixedPurchaseSelection() {
      if (productOptions.length < 1) return;
      state.hasUserSelectedOptions = !!state.variant;
      renderVariantControls();
    }
  
    /** 更新浏览器 URL 中的 variant 参数，刷新后仍能保持当前变体。 */
    function updateVariantUrl() {
      if (!state.variant || !window.history || !window.history.replaceState) return;
  
      try {
        var url = new URL(window.location.href);
        url.searchParams.set("variant", state.variant.id);
        window.history.replaceState({}, "", url.toString());
      } catch (error) {
        // 老浏览器不支持 URL 时不影响购买功能。
      }
    }
  
    /** 一次性刷新所有与商品状态相关的 DOM。 */
    function renderProductState() {
      renderQuantity();
      renderVariantControls();
      renderProductInformation();
      renderPurchaseButtons();
    }
  
    /** 设置全局数量并立即同步所有数量组件和价格。 */
    function setQuantity(value) {
      state.quantity = normalizeQuantity(value);
      renderQuantity();
      renderProductInformation();
    }
  
    /**
     * 设置某一组选项。
     * 如果组合不存在，会寻找包含本次选项值的第一个可售变体，避免购买错误 SKU。
     */
    function setOption(optionIndex, optionValue) {
      if (String(optionValue || "") === "") {
        resetFixedPurchaseSelection();
        return;
      }

      var nextOptions = state.selectedOptions.slice();
      nextOptions[optionIndex] = String(optionValue);
  
      var nextVariant = findVariantByOptions(nextOptions);
      if (!nextVariant) nextVariant = findAvailableVariantForOption(optionIndex, optionValue);
  
      if (!nextVariant) {
        showToast("Ova opcija trenutno nije dostupna.", "error");
        renderVariantControls();
        return;
      }
  
      state.variant = nextVariant;
      state.hasUserSelectedOptions = true;
      state.selectedOptions = getVariantOptions(nextVariant);
      renderProductState();
      updateVariantUrl();
      syncProductGallery(optionIndex, optionValue);
    }
  
    /** 初始化当前变体：优先 URL，其次 Liquid 选中变体，最后选择第一个可售变体。 */
    function initializeProductState() {
      var urlVariantId = "";
  
      try {
        urlVariantId = new URL(window.location.href).searchParams.get("variant") || "";
      } catch (error) {
        urlVariantId = "";
      }
  
      state.variant =
        findVariantById(urlVariantId) ||
        findVariantById(selectedVariantId) ||
        productVariants.find(function (variant) { return variant.available !== false; }) ||
        productVariants[0] ||
        null;
  
      state.selectedOptions = getVariantOptions(state.variant);
      state.hasUserSelectedOptions = !!state.variant;
      state.quantity = normalizeQuantity($(".js-calcNumber").first().val() || 1);
      renderProductState();
      renderCartCount(state.cartCount);
    }
  
    /** 初始化产品图、顶部通知条和移动端信息条的 Swiper。 */
    function initializeSwipers() {
      if (typeof window.Swiper !== "function") return;
  
      $(".js-swiper-fade-top").each(function () {
        if (this.swiper) return;
        new window.Swiper(this, {
          effect: "fade",
          loop: true,
          speed: 600,
          autoplay: { delay: 2600, disableOnInteraction: false }
        });
      });
  
      $(".js-text-ticker").each(function () {
        if (this.swiper) return;
        new window.Swiper(this, {
          direction: "vertical",
          slidesPerView: 1,
          loop: true,
          speed: 520,
          spaceBetween: 8,
          allowTouchMove: false,
          autoplay: { delay: 2600, disableOnInteraction: false }
        });
      });
    }
  
    /** 注入 PC 主图加载反馈样式，避免依赖主题中额外的 CSS。 */
    function installPcMainImageLoaderStyle() {
      if (document.getElementById("sp-pc-main-image-loader-style")) return;
  
      var style = document.createElement("style");
      style.id = "sp-pc-main-image-loader-style";
      style.textContent = [
        "@media (min-width:768px){",
        "[data-sp-pc-gallery]{position:relative;}",
        "[data-sp-pc-gallery] .js-pc-main-image{transition:opacity .18s ease;}",
        "[data-sp-pc-gallery].is-image-loading .js-pc-main-image{opacity:.58;}",
        ".js-pc-main-image-loader{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.38);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .18s ease,visibility .18s ease;}",
        "[data-sp-pc-gallery].is-image-loading .js-pc-main-image-loader{opacity:1;visibility:visible;}",
        ".js-pc-main-image-loader__spinner{width:38px;height:38px;box-sizing:border-box;border:3px solid rgba(17,24,39,.18);border-top-color:#111827;border-radius:50%;animation:spPcMainImageSpin .72s linear infinite;}",
        "}",
        "@keyframes spPcMainImageSpin{to{transform:rotate(360deg);}}",
        "@media (prefers-reduced-motion:reduce){.js-pc-main-image-loader__spinner{animation-duration:1.4s;}[data-sp-pc-gallery] .js-pc-main-image{transition:none;}}"
      ].join("");
      document.head.appendChild(style);
    }
  
    /** 创建并返回 PC 主图的加载遮罩。 */
    function getPcMainImageLoader() {
      var $gallery = $("[data-sp-pc-gallery]").first();
      if (!$gallery.length) return $();
  
      installPcMainImageLoaderStyle();
      var $loader = $gallery.children(".js-pc-main-image-loader").first();
      if (!$loader.length) {
        $loader = $(
          "<div class=\"js-pc-main-image-loader\" role=\"status\" aria-live=\"polite\" aria-label=\"Učitavanje slike proizvoda\">" +
            '<span class="js-pc-main-image-loader__spinner" aria-hidden="true"></span>' +
          "</div>"
        );
        $gallery.append($loader);
      }
      return $loader;
    }
  
    /** 显示或隐藏 PC 主图加载状态，同时向辅助技术报告 busy 状态。 */
    function setPcMainImageLoading(isLoading) {
      var $gallery = $("[data-sp-pc-gallery]").first();
      if (!$gallery.length) return;
  
      getPcMainImageLoader();
      $gallery.toggleClass("is-image-loading", Boolean(isLoading));
      if (isLoading) {
        $gallery.attr("aria-busy", "true");
      } else {
        $gallery.removeAttr("aria-busy");
      }
    }
  
    /**
     * 复用已经加载或正在加载的 PC 产品图。
     * 同一个 URL 在本次页面访问中只创建一个 Image 预加载任务。
     */
    function getPcMainImageCacheEntry($source) {
      var src = $source.attr("src");
      var sourceImage = $source.get(0);
      var cached = pcMainImageCache[src];
  
      if (cached && cached.status !== "error") return cached;
  
      if (sourceImage && sourceImage.complete && sourceImage.naturalWidth > 0) {
        cached = { status: "loaded", image: sourceImage, callbacks: [] };
        pcMainImageCache[src] = cached;
        return cached;
      }
  
      var image = new Image();
      cached = { status: "loading", image: image, callbacks: [] };
      pcMainImageCache[src] = cached;
  
      function settle(status) {
        if (cached.status !== "loading") return;
        cached.status = status;
        var callbacks = cached.callbacks.slice();
        cached.callbacks.length = 0;
        callbacks.forEach(function (callback) {
          callback(status === "loaded");
        });
      }
  
      image.onload = function () { settle("loaded"); };
      image.onerror = function () { settle("error"); };
  
      var srcset = $source.attr("srcset");
      var sizes = $source.attr("sizes");
      if (srcset) image.srcset = srcset;
      if (sizes) image.sizes = sizes;
      image.src = src;
  
      if (image.complete && image.naturalWidth > 0) settle("loaded");
      return cached;
    }
  
    /** 把指定产品图预加载后同步到 PC 静态主图，不创建 PC 主图 Swiper。 */
    function syncPcMainImage(index) {
      var $source = $("[data-sp-product-gallery] .js-product-slide").eq(index).find(".js-img-p").first();
      var $target = $(".js-pc-main-image").first();
      var nextSrc = $source.attr("src");
      if (!$source.length || !$target.length || !nextSrc) return;
  
      var token = ++pcMainImageLoadToken;
      var targetImage = $target.get(0);
      var attributes = ["src", "srcset", "sizes", "alt", "width", "height", "data-image-id", "data-image-position"];
  
      function copySourceAttributes() {
        attributes.forEach(function (attribute) {
          var value = $source.attr(attribute);
          if (typeof value !== "undefined") {
            $target.attr(attribute, value);
          } else if (attribute === "srcset" || attribute === "sizes") {
            $target.removeAttr(attribute);
          }
        });
        $target.attr("loading", "eager").attr("decoding", "async");
      }
  
      window.clearTimeout(pcMainImageLoadTimer);
  
      if ($target.attr("src") === nextSrc && targetImage.complete && targetImage.naturalWidth > 0) {
        copySourceAttributes();
        setPcMainImageLoading(false);
        return;
      }
  
      var cacheEntry = getPcMainImageCacheEntry($source);
  
      if (cacheEntry.status === "loaded") {
        copySourceAttributes();
        setPcMainImageLoading(false);
        window.requestAnimationFrame(syncProductMediaHeight);
        return;
      }
  
      setPcMainImageLoading(true);
  
      function finishLoad(succeeded) {
        if (token !== pcMainImageLoadToken) return;
        window.clearTimeout(pcMainImageLoadTimer);
  
        if (succeeded) {
          copySourceAttributes();
          window.requestAnimationFrame(syncProductMediaHeight);
        } else if (window.console && typeof window.console.warn === "function") {
          window.console.warn("Product main image failed to load:", nextSrc);
        }
        setPcMainImageLoading(false);
      }
  
      cacheEntry.callbacks.push(finishLoad);
      pcMainImageLoadTimer = window.setTimeout(function () {
        if (token !== pcMainImageLoadToken) return;
        pcMainImageLoadToken += 1;
        setPcMainImageLoading(false);
        if (window.console && typeof window.console.warn === "function") {
          window.console.warn("Product main image loading timed out:", nextSrc);
        }
      }, 15000);
    }
  
    /** 同步 PC 静态主图、移动端 Swiper、缩略图和公共图库索引。 */
    function updateGalleryActiveState(index) {
      state.galleryIndex = Math.max(0, Number(index) || 0);
      $(".js-product-slide").removeClass("is-active").eq(state.galleryIndex).addClass("is-active");
      $(".js-product-thumb").removeClass("is-active").eq(state.galleryIndex).addClass("is-active");
      var lastIndex = Math.max(0, $(".js-product-slide").length - 1);
      $(".js-thumb-prev")
        .toggleClass("swiper-button-disabled", state.galleryIndex <= 0)
        .attr("aria-disabled", state.galleryIndex <= 0 ? "true" : "false");
      $(".js-thumb-next")
        .toggleClass("swiper-button-disabled", state.galleryIndex >= lastIndex)
        .attr("aria-disabled", state.galleryIndex >= lastIndex ? "true" : "false");
      if (state.thumbsSwiper) state.thumbsSwiper.slideTo(state.galleryIndex, 250);
      syncPcMainImage(state.galleryIndex);
    }
  
    /** 使用主图 Swiper 切换到指定图片。 */
    function slideProductGallery(index, animate) {
      var slideCount = $(".js-product-slide").length;
      if (!slideCount) return;
      var targetIndex = Math.max(0, Math.min(slideCount - 1, Number(index) || 0));
      if (state.gallerySwiper) state.gallerySwiper.slideTo(targetIndex, animate === false ? 0 : 350);
      updateGalleryActiveState(targetIndex);
    }
  
    /** 初始化图库：PC 使用静态主图，767px 及以下才创建主图 Swiper。 */
    function initializeProductGallerySwiper() {
      var galleryElement = document.querySelector("[data-sp-product-gallery]");
      var thumbsElement = document.querySelector("[data-sp-product-thumbs]");
      if (!galleryElement || typeof window.Swiper !== "function") return;
  
      state.thumbsSwiper = thumbsElement && (thumbsElement.swiper || new window.Swiper(thumbsElement, {
        direction: "horizontal",
        loop: false,
        slidesPerView: "auto",
        spaceBetween: 5.57,
        freeMode: true,
        watchSlidesProgress: true,
        // ==========滚轮配置新增============
        mousewheel: {
          enabled: true,
          sensitivity: 1.2,    // 滚动灵敏度
          forceToAxis: true,   // 水平swiper只响应水平滚动、垂直只响应垂直（强烈建议开启）
        },
        breakpoints: { 
          768: { 
            direction: "vertical", 
            spaceBetween: 8 
          } 
        }
      }));
  
      /** 仅在 767px 及以下创建主图 Swiper；从 PC 缩放到该宽度时按需初始化。 */
      function ensureMobileGallerySwiper() {
        if (window.innerWidth > 767 || state.gallerySwiper) return;
  
        state.gallerySwiper = galleryElement.swiper || new window.Swiper(galleryElement, {
          loop: false,
          initialSlide: state.galleryIndex,
          speed: 350,
          slidesPerView: "auto",
          spaceBetween: 6,
          centeredSlides: true,
          centeredSlidesBounds: true,
          grabCursor: true,
          watchOverflow: true,
          navigation: { prevEl: ".js-gallery-prev", nextEl: ".js-gallery-next" },
          thumbs: state.thumbsSwiper ? { swiper: state.thumbsSwiper } : undefined,
          on: {
            init: function () { updateGalleryActiveState(this.realIndex || 0); },
            slideChange: function () { updateGalleryActiveState(this.realIndex || 0); }
          }
        });
      }
  
      ensureMobileGallerySwiper();
      $(window).on("resize.spMobileGallery", function () {
        if (window.innerWidth >= 768 && state.gallerySwiper) {
          state.gallerySwiper.destroy(true, true);
          state.gallerySwiper = null;
          syncProductMediaHeight();
        }
        if (window.innerWidth <= 767 && !state.gallerySwiper) {
          window.requestAnimationFrame(ensureMobileGallerySwiper);
        }
      });
  
      updateGalleryActiveState(0);
    }
  
    /** 让右侧缩略图 Swiper 高度始终等于“主图 + 倒计时”的实际高度。 */
    function syncProductMediaHeight() {
      if (window.innerWidth <= 767) return;
      var $galleryMain = $(".js-gallery-main").first();
      var $visual = $galleryMain.find(".js-product-visual").first();
      if (!$galleryMain.length || !$visual.length) return;
  
      var visualHeight = Math.ceil($visual.outerHeight());
      if (visualHeight < 1) return;
      $galleryMain[0].style.setProperty("--sp-media-height", visualHeight + "px");
    }
  
    /** 在图片载入及窗口尺寸变化后重新校正媒体高度。 */
    function initializeProductMediaSizing() {
      var resizeTimer = null;
  
      window.requestAnimationFrame(syncProductMediaHeight);
      $(window).on("load.spProductMedia", syncProductMediaHeight);
      $(".js-img-p").on("load.spProductMedia", syncProductMediaHeight);
      $(window).on("resize.spProductMedia", function () {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(syncProductMediaHeight, 120);
      });
    }
  
    /** 强制切换产品主图，单独处理索引 0，避免 Swiper 回不到第一张。 */
    function goToProductImage(index, speed) {
      var slideCount = $(".js-product-slide").length;
      if (!slideCount) return;
      var targetIndex = Math.max(0, Math.min(slideCount - 1, Number(index) || 0));
      slideProductGallery(targetIndex, speed !== 0);
    }
  
    /** PC 与移动端共用：按前后方向切换主图，并让缩略图轨道跟随当前图片。 */
    function stepProductImage(direction) {
      var slideCount = $(".js-product-slide").length;
      if (!slideCount) return;
      var targetIndex = state.galleryIndex + (direction < 0 ? -1 : 1);
      if (targetIndex < 0 || targetIndex >= slideCount) return;
      goToProductImage(targetIndex, 350);
    }
  
    /** 15 minutes, 59 seconds, 59 hundredths of a second; one deadline per browsing session. */
    function initializeCountdown() {
      if (!document.querySelector(".sp-shopping-countdown")) return;
      var storageKey = "lp-shopping-countdown-15m59s59cs";
      var duration = 15 * 60000 + 59 * 1000 + 590;
      var now = Date.now();
      var endTime = 0;
      try { endTime = Number(window.sessionStorage.getItem(storageKey)) || 0; } catch (error) {}
      if (!endTime || !isFinite(endTime) || endTime <= now || endTime > now + duration) {
        endTime = now + duration;
        try { window.sessionStorage.setItem(storageKey, String(endTime)); } catch (error) {}
      }
      var minutes = document.querySelectorAll("[data-shopping-minutes]");
      var seconds = document.querySelectorAll("[data-shopping-seconds]");
      var hundredths = document.querySelectorAll("[data-shopping-hundredths]");
      function renderCountdown() {
        var remaining = Math.max(0, endTime - Date.now());
        var mm = String(Math.floor(remaining / 60000)).padStart(2, "0");
        var ss = String(Math.floor(remaining % 60000 / 1000)).padStart(2, "0");
        var cs = String(Math.floor(remaining % 1000 / 10)).padStart(2, "0");
        minutes.forEach(function (node) { node.textContent = mm; });
        seconds.forEach(function (node) { node.textContent = ss; });
        hundredths.forEach(function (node) { node.textContent = cs; });
        document.querySelectorAll(".sp-shopping-countdown").forEach(function (node) {
          node.classList.toggle("is-ended", remaining === 0);
        });
        return remaining === 0;
      }
      if (renderCountdown()) return;
      var countdownTimer = window.setInterval(function () {
        if (renderCountdown()) window.clearInterval(countdownTimer);
      }, 16);
    }

    /** 变体切换后同步轮播：优先变体图片，否则按第一组选项索引切换。 */
    function syncProductGallery(optionIndex, optionValue) {
      if (!$("[data-sp-product-gallery]").length) return;
  
      var imageUrl = getVariantImage(state.variant);
      var imageId = getVariantImageId(state.variant);
      var targetIndex = -1;
  
      if (imageId) {
        $("[data-sp-product-gallery] .js-img-p").each(function (index) {
          if (String($(this).attr("data-image-id") || "") === imageId) targetIndex = index;
        });
      }
  
      if (targetIndex < 0 && imageUrl) {
        $("[data-sp-product-gallery] .js-img-p").each(function (index) {
          var source = String($(this).attr("src") || "").split("?")[0];
          var target = String(imageUrl).split("?")[0];
          if (source === target || source.indexOf(target) > -1 || target.indexOf(source) > -1) targetIndex = index;
        });
      }
  
      if (targetIndex < 0 && Number(optionIndex) === 0) {
        targetIndex = $(".js-opt-group[data-option-index='0'] .js-option").filter(function () {
          return String($(this).attr("data-val")) === String(optionValue);
        }).index();
      }
  
      if (targetIndex >= 0) goToProductImage(targetIndex, 350);
    }
  
    /** Estimate delivery dates from the visitor's local date: 7 to 10 days from today. */
    function initializeDeliveryDates() {
      var today = new Date();
      var startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
      var endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 10);
  
      /** Show dates in English, for example Sep 29. */
      function formatMonthDay(date) {
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }
  
      $("[data-sp-delivery-start]").text(formatMonthDay(startDate));
      $("[data-sp-delivery-end]").text(formatMonthDay(endDate));
    }
  
    /** 打开尺码指南弹窗。 */
    var sizeGuideReturnFocus = null;
    function openSizeGuide() {
      sizeGuideReturnFocus = document.activeElement;
      $("[data-sp-size-modal]").addClass("is-open").attr("aria-hidden", "false");
      $("body").addClass("sp-size-modal-open");
      window.setTimeout(function () {
        if ($("[data-sp-size-modal]").hasClass("is-open")) document.querySelector(".sp-size-modal__close").focus({ preventScroll: true });
      }, 230);
    }
  
    /** 关闭尺码指南弹窗。 */
    function closeSizeGuide() {
      $("[data-sp-size-modal]").removeClass("is-open").attr("aria-hidden", "true");
      var wasOpen = $("body").hasClass("sp-size-modal-open");
      $("body").removeClass("sp-size-modal-open");
      if (wasOpen && sizeGuideReturnFocus && sizeGuideReturnFocus.isConnected) {
        var closedDrawer = sizeGuideReturnFocus.closest(".sph__drawer[aria-hidden='true']");
        var returnTarget = closedDrawer ? document.querySelector(".sph__menu-toggle") : sizeGuideReturnFocus;
        if (returnTarget) returnTarget.focus();
      }
    }
  
    /** 显示轻量提示消息，成功和失败都使用同一组件。 */
    function showToast(message, type) {
      var $toast = $("[data-sp-toast]");
      if (!$toast.length) {
        $toast = $("<div/>", { "data-sp-toast": "", "class": "sp-shop-toast js-shop-toast" }).appendTo("body");
      }
  
      $toast
        .stop(true, true)
        .removeClass("is-error is-success")
        .addClass(type === "error" ? "is-error" : "is-success")
        .text(message)
        .addClass("is-visible");
  
      window.clearTimeout($toast.data("timer"));
      $toast.data("timer", window.setTimeout(function () {
        $toast.removeClass("is-visible");
      }, 2800));
    }
  
    /** 把当前活动产品图做成飞入购物车的小动画。 */
    function animateToCart($source) {
      var $image = $(".js-pc-main-image:visible, [data-sp-product-gallery] .js-product-slide.is-active .js-img-p:visible").first();
      var $target = $(".js-cart:visible, .js-fixed-purchase__cart:visible").first();
      if (!$image.length || !$target.length) return;
  
      var sourceRect = $image[0].getBoundingClientRect();
      var targetRect = $target[0].getBoundingClientRect();
      var $flyer = $image.clone().removeAttr("id").addClass("js-cart-flyer").appendTo("body");
  
      $flyer.css({
        top: sourceRect.top,
        left: sourceRect.left,
        width: Math.min(sourceRect.width, 150),
        height: Math.min(sourceRect.height, 150)
      }).animate({
        top: targetRect.top,
        left: targetRect.left,
        width: 32,
        height: 32,
        opacity: .25
      }, 520, function () {
        $flyer.remove();
      });
    }
  
    /** 向 Shopify 加入当前变体；页面任意 .js-add-cart 都调用此函数。 */
    function addToCart($button) {
      if (state.adding) return;
      var shouldResetFixedPurchase = $button && $button.hasClass && $button.hasClass("js-fixed-purchase__cart");
      if (!state.variant || !state.variant.id) {
        showToast("Odaberite opciju proizvoda.", "error");
        return;
      }
      if (state.variant.available === false) {
        showToast("Ova varijanta je rasprodana.", "error");
        return;
      }
  
      state.adding = true;
      $(".js-add-cart").addClass("is-loading").attr("aria-busy", "true");
  
      $.ajax({
        type: "POST",
        url: getEndpoint("cart/add.js"),
        dataType: "json",
        contentType: "application/json",
        data: JSON.stringify({ id: state.variant.id, quantity: state.quantity })
      }).done(function () {
        animateToCart($button);
        if (shouldResetFixedPurchase) resetFixedPurchaseSelection();
        // showToast("Added to your cart.", "success");
        refreshCart(true);
      }).fail(function (xhr) {
        showToast(getAjaxError(xhr, "Nije moguće dodati ovu stavku u košaricu."), "error");
      }).always(function () {
        state.adding = false;
        $(".js-add-cart").removeClass("is-loading").removeAttr("aria-busy");
      });
    }
  
    /** 使用 Shopify cart permalink 直接进入当前变体的结账流程。 */
    function buyNow() {
      if (state.buying) return;
      if (!state.variant || !state.variant.id) {
        showToast("Odaberite opciju proizvoda.", "error");
        return;
      }
      if (state.variant.available === false) {
        showToast("Ova varijanta je rasprodana.", "error");
        return;
      }
  
      state.buying = true;
      $(".js-buy-now").addClass("is-loading").attr("aria-busy", "true");
      var checkoutUrl = getEndpoint("cart/") + state.variant.id + ":" + state.quantity + "?checkout";
  
      // 留出短暂时间绘制加载动画，再进入 Shopify 结账页。
      window.setTimeout(function () {
        window.location.href = checkoutUrl;
      }, 260);
    }
  
    /** 从结账页返回产品页时，清理浏览器 bfcache 保留下来的购买按钮加载状态。 */
    function resetTransientPurchaseState() {
      state.buying = false;
      $(".js-buy-now").removeClass("is-loading").removeAttr("aria-busy");
    }
  
    /** 监听浏览器返回/前进缓存恢复，避免按钮一直停留在转圈状态。 */
    function initializePageRestoreState() {
      window.addEventListener("pageshow", function () {
        window.setTimeout(resetTransientPurchaseState, 0);
      });
    }
  
    /** 从 Shopify 错误响应中提取可读错误信息。 */
    function getAjaxError(xhr, fallback) {
      var response = xhr && xhr.responseJSON;
      if (response && (response.description || response.message)) {
        return response.description || response.message;
      }
  
      try {
        response = JSON.parse(xhr.responseText);
        return response.description || response.message || fallback;
      } catch (error) {
        return fallback;
      }
    }
  
    /** 打开购物车抽屉；本次页面访问中第一次打开时才请求完整购物车。 */
    function openCartDrawer() {
      $("[data-sp-drawer-overlay], [data-sp-cart-drawer]").addClass("is-open").attr("aria-hidden", "false");
      $("body").addClass("sp-drawer-open js-drawer-open");
      if (!state.cartLoaded && !state.drawerLoading) refreshCart(false);
    }
  
    /** 关闭购物车抽屉。 */
    function closeCartDrawer() {
      $("[data-sp-drawer-overlay], [data-sp-cart-drawer]").removeClass("is-open").attr("aria-hidden", "true");
      $("body").removeClass("sp-drawer-open js-drawer-open");
    }
  
    /** 从 Shopify 获取实时购物车；添加成功时可在完成后自动打开抽屉。 */
    function refreshCart(openAfterLoad) {
      if (state.drawerLoading) return;
      state.drawerLoading = true;
      setDrawerLoading(true);
  
      $.getJSON(getEndpoint("cart.js"))
        .done(function (cart) {
          renderCartDrawer(cart);
          if (openAfterLoad) openCartDrawer();
        })
        .fail(function (xhr) {
          showToast(getAjaxError(xhr, "Nije moguće učitati vašu košaricu."), "error");
        })
        .always(function () {
          state.drawerLoading = false;
          setDrawerLoading(false);
        });
    }
  
    /** 切换购物车抽屉的加载状态。 */
    function setDrawerLoading(loading) {
      $("[data-sp-cart-loading]").toggleClass("is-visible", !!loading);
      if (loading) $("[data-sp-cart-items]").attr("aria-busy", "true");
      else $("[data-sp-cart-items]").removeAttr("aria-busy");
    }
  
    /** 创建购物车删除按钮使用的 SVG 垃圾桶图标。 */
    function createCartTrashIcon() {
      var namespace = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(namespace, "svg");
      var path = document.createElementNS(namespace, "path");
  
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.8");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      path.setAttribute("d", "M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6");
      svg.appendChild(path);
      return svg;
    }
  
    /** 获取购物车商品的单件对比价：优先使用购物车字段，否则从页面产品变体中匹配。 */
    function getCartItemCompareAtPrice(item) {
      var directComparePrice = Number(item && item.compare_at_price) || 0;
      if (directComparePrice > 0) return directComparePrice;
  
      var variant = findVariantById(item && (item.variant_id || item.id));
      return Number(variant && variant.compare_at_price) || 0;
    }
  
    /** 使用 jQuery 节点构建一条购物车商品，避免不安全的 HTML 字符串拼接。 */
    function createCartItem(item, lineNumber) {
      var $item = $("<article/>", { "class": "sp-cart-drawer__item js-cart-drawer__item", "data-line": lineNumber });
      var $imageWrap = $("<div/>", { "class": "sp-cart-drawer__image-wrap" }).appendTo($item);
      $("<img/>", {
        "class": "sp-cart-drawer__image",
        src: item.image || "",
        alt: item.product_title || item.title || "Product"
      }).appendTo($imageWrap);
      $("<span/>", { "class": "sp-cart-drawer__item-loader", "aria-hidden": "true" }).appendTo($imageWrap);
  
      var $main = $("<div/>", { "class": "sp-cart-drawer__item-main" }).appendTo($item);
      $("<p/>", { "class": "sp-cart-drawer__item-title", text: item.product_title || item.title }).appendTo($main);
      $("<p/>", {
        "class": "sp-cart-drawer__variant",
        text: item.variant_title && item.variant_title !== "Default Title" ? item.variant_title : ""
      }).appendTo($main);
  
      var $bottom = $("<div/>", { "class": "sp-cart-drawer__item-bottom" }).appendTo($main);
      var $controls = $("<div/>", { "class": "sp-cart-drawer__item-controls" }).appendTo($bottom);
      var $quantity = $("<div/>", { "class": "sp-cart-drawer__qty js-cart-drawer__qty" }).appendTo($controls);
      $("<button/>", {
        type: "button",
        "class": "js-drawer-qty-minus",
        "aria-label": "Smanjite količinu",
        text: "−"
      }).appendTo($quantity);
      $("<span/>", { text: item.quantity }).appendTo($quantity);
      $("<button/>", {
        type: "button",
        "class": "js-drawer-qty-plus",
        "aria-label": "Povećajte količinu",
        text: "+"
      }).appendTo($quantity);
      var $removeButton = $("<button/>", {
        type: "button",
        "class": "sp-cart-drawer__remove js-cart-drawer__remove",
        "aria-label": "Ukloni stavku",
        title: "Ukloni stavku"
      }).appendTo($controls);
      $removeButton.append(createCartTrashIcon());
      var itemQuantity = Math.max(1, Number(item.quantity) || 1);
      var sellingUnitPrice = Number(item.final_price);
      if (!isFinite(sellingUnitPrice)) {
        sellingUnitPrice = Number(item.price) || Math.round((Number(item.final_line_price) || 0) / itemQuantity);
      }
      var sellingLinePrice = Number(item.final_line_price);
      if (!isFinite(sellingLinePrice)) sellingLinePrice = sellingUnitPrice * itemQuantity;
      var compareUnitPrice = getCartItemCompareAtPrice(item);
      var $priceGroup = $("<div/>", { "class": "sp-cart-drawer__price-group" }).appendTo($bottom);
      $("<span/>", { "class": "sp-cart-drawer__price", text: formatMoney(sellingLinePrice) }).appendTo($priceGroup);
      if (compareUnitPrice > sellingUnitPrice) {
        $("<span/>", { "class": "sp-cart-drawer__compare-price", text: formatMoney(compareUnitPrice * itemQuantity) }).appendTo($priceGroup);
      }
  
      return $item;
    }
  
    /** 根据 cart.js 返回值完整刷新抽屉、合计和页面全部购物车角标。 */
    function renderCartDrawer(cart) {
      var items = cart && $.isArray(cart.items) ? cart.items : [];
      state.cartLoaded = true;
      if (cart && cart.currency) activeCurrencyCode = String(cart.currency);
      var $items = $("[data-sp-cart-items]").empty();
      var isEmpty = items.length === 0;
  
      items.forEach(function (item, index) {
        $items.append(createCartItem(item, index + 1));
      });
  
      $("[data-sp-cart-empty]").toggleClass("is-visible", isEmpty);
      $("[data-sp-cart-footer]").prop("hidden", isEmpty);
      $("[data-sp-cart-total]").text(formatMoney(cart.total_price || 0));
      var cartNote = String(cart.note || "");
      var $noteInput = $("[data-sp-cart-note]");
      if (!$noteInput.data("dirty")) $noteInput.val(cartNote);
      $noteInput.attr("data-saved-note", cartNote);
      $("[data-sp-cart-note-toggle-label]").text(cartNote ? "Uredi bilješku" : "Dodaj bilješku");
      renderCartCount(cart.item_count || 0);
    }
  
    /** 只切换当前购物车商品行的图片加载动画与按钮状态。 */
    function setCartItemLoading($item, loading) {
      if (!$item || !$item.length) return;
      $item.toggleClass("is-loading", !!loading).attr("aria-busy", loading ? "true" : "false");
      $item.find("button").prop("disabled", !!loading);
      if (!loading) $item.removeAttr("aria-busy");
    }
  
    /** 修改购物车中某一行数量；quantity 为 0 时 Shopify 会删除该行。 */
    function changeCartLine(lineNumber, quantity, $item) {
      if ($item && $item.hasClass("is-loading")) return;
      setCartItemLoading($item, true);
  
      $.ajax({
        type: "POST",
        url: getEndpoint("cart/change.js"),
        dataType: "json",
        contentType: "application/json",
        data: JSON.stringify({ line: Number(lineNumber), quantity: Math.max(0, Number(quantity) || 0) })
      }).done(function (cart) {
        renderCartDrawer(cart);
      }).fail(function (xhr) {
        showToast(getAjaxError(xhr, "Nije moguće ažurirati vašu košaricu."), "error");
        refreshCart(false);
      }).always(function () {
        setCartItemLoading($item, false);
      });
    }
  
    /** 使用 Shopify cart/update.js 保存订单备注。 */
    function saveCartNote() {
      if (state.noteSaving) return;
      var $input = $("[data-sp-cart-note]").first();
      var $button = $("[data-sp-cart-note-save]").first();
      var $status = $("[data-sp-cart-note-status]").first();
      if (!$input.length) return;
  
      var note = String($input.val() || "");
      if (note === String($input.attr("data-saved-note") || "")) {
        $input.data("dirty", false);
        $status.text("Spremljeno");
        return;
      }
  
      state.noteSaving = true;
      $button.prop("disabled", true).text("Spremanje vaše bilješke…");
      $status.text("Spremanje vaše bilješke…");
  
      $.ajax({
        type: "POST",
        url: getEndpoint("cart/update.js"),
        dataType: "json",
        contentType: "application/json",
        data: JSON.stringify({ note: note })
      }).done(function (cart) {
        var savedNote = String(cart.note || note);
        $input.val(savedNote).attr("data-saved-note", savedNote).data("dirty", false);
        $("[data-sp-cart-note-toggle-label]").text(savedNote ? "Uredi bilješku" : "Dodaj bilješku");
        $status.text("Napomena spremljena");
      }).fail(function (xhr) {
        $status.text("Nije moguće spremiti vašu bilješku");
        showToast(getAjaxError(xhr, "Nije moguće spremiti vašu bilješku."), "error");
      }).always(function () {
        state.noteSaving = false;
        $button.prop("disabled", false).text("Spremi bilješku");
      });
    }
  
    /** 初始化固定底栏显隐：下滑超过 500px 且 #shopping 不在视口内时显示。 */
    function initializeFixedPurchaseBar() {
      var bar = document.querySelector("[data-sp-fixed-purchase]");
      var shoppingModule = document.getElementById("shopping");
      if (!bar) return;
  
      var showOffset = 500;
      var ticking = false;
  
      function setVisible(visible) {
        $(bar).toggleClass("is-visible", !!visible);
        $("body").toggleClass("sp-has-fixed-purchase", !!visible);
      }
  
      function isElementInViewport(element) {
        if (!element) return false;
  
        var rect = element.getBoundingClientRect();
        var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  
        return rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
      }
  
      function updateFixedPurchaseBar() {
        ticking = false;
  
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
        var shoppingInViewport = isElementInViewport(shoppingModule);
  
        setVisible(scrollTop > showOffset && !shoppingInViewport);
      }
  
      function requestFixedPurchaseBarUpdate() {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(updateFixedPurchaseBar);
      }
  
      $(window)
        .off("scroll.spFixedPurchase resize.spFixedPurchase")
        .on("scroll.spFixedPurchase resize.spFixedPurchase", requestFixedPurchaseBarUpdate);
  
      updateFixedPurchaseBar();
    }
  
    /** 初始化页内锚点平滑滚动和移动端菜单开关。 */
    function initializePageNavigation() {
      $document.on("click.spShopping", 'a[href^="#"]', function (event) {
        var selector = $(this).attr("href");
        if (!selector || selector === "#") return;
        var $target = $(selector);
        if (!$target.length) return;
  
        event.preventDefault();
        $("html, body").stop(true).animate({ scrollTop: Math.max(0, $target.offset().top - 80) }, 480);
        $(".js-menu-mask").fadeOut(160);
      });
  
      $document.on("click.spShopping", ".js-menu-btn", function () {
        $(".js-menu-mask").fadeIn(180);
      });
      $document.on("click.spShopping", ".js-close-btn, .js-menu-mask", function (event) {
        if ($(event.target).closest(".js-menu").length && !$(event.target).is(".js-close-btn")) return;
        $(".js-menu-mask").fadeOut(160);
      });
    }
  
  
    /**
     * 图片和视频懒加载
     * ------------------------------------------------------------
     * 图片：<img class="js-lazy-image" data-src="image.webp" alt="">
     *
     * 响应式图片：
     * <picture>
     *   <source media="(max-width: 767px)" data-srcset="mobile.webp">
     *   <img class="js-lazy-image" data-src="desktop.webp" alt="">
     * </picture>
     *
     * 响应式视频：
     * <video class="js-lazy-video" muted loop playsinline preload="none" poster="poster.webp">
     *   <source media="(max-width: 767px)" data-src="mobile.mp4" type="video/mp4">
     *   <source media="(min-width: 768px)" data-src="desktop.mp4" type="video/mp4">
     * </video>
     *
     * 加载策略参考竞品：
     * 1. 图片距离视口底部约 1300px 时提前加载。
     * 2. 视频距离视口底部约 600px 时提前加载和缓冲。
     * 3. 视频可见面积达到 35% 时静音循环播放，离开后暂停。
     * 4. 离开视口只暂停，不删除 src，避免返回时重复下载。
     */
  
    /** 返回 root 本身及其后代中符合 selector 的元素，供 Shopify 动态 Section 重扫。 */
    function getLazyTargets(root, selector) {
      root = root || document;
      var targets = [];
  
      if (root.nodeType === 1 && root.matches && root.matches(selector)) {
        targets.push(root);
      }
  
      if (!root.querySelectorAll) return targets;
  
      var descendants = root.querySelectorAll(selector);
      for (var index = 0; index < descendants.length; index += 1) {
        targets.push(descendants[index]);
      }
  
      return targets;
    }
  
    /** 把 picture/source 和 img 上的 data-src/data-srcset 换成真实资源地址。 */
    function loadLazyImage(image) {
      if (!image || image.getAttribute("data-lazy-loaded") === "true") return;
  
      var picture = image.parentElement && image.parentElement.tagName === "PICTURE"
        ? image.parentElement
        : null;
      var sources = picture ? picture.querySelectorAll("source") : [];
  
      for (var index = 0; index < sources.length; index += 1) {
        var sourceSrcset = sources[index].getAttribute("data-srcset");
        var sourceSizes = sources[index].getAttribute("data-sizes");
        if (sourceSizes) sources[index].setAttribute("sizes", sourceSizes);
        if (sourceSrcset) sources[index].setAttribute("srcset", sourceSrcset);
      }
  
      var sizes = image.getAttribute("data-sizes");
      var srcset = image.getAttribute("data-srcset");
      var src = image.getAttribute("data-src");
  
      if (sizes) image.setAttribute("sizes", sizes);
      if (srcset) image.setAttribute("srcset", srcset);
      if (src) image.setAttribute("src", src);
  
      image.setAttribute("data-lazy-loaded", "true");
      image.removeAttribute("data-lazy-image-observed");
    }
  
    /** 把 video/source 上的 data-src 换成真实地址，并开始缓冲当前设备匹配的视频。 */
    function loadLazyVideo(video) {
      if (!video || video.getAttribute("data-lazy-loaded") === "true") return;
  
      var assignedSource = false;
      var videoSrc = video.getAttribute("data-src");
      var sources = video.querySelectorAll("source[data-src]");
  
      if (videoSrc) {
        video.setAttribute("src", videoSrc);
        assignedSource = true;
      }
  
      for (var index = 0; index < sources.length; index += 1) {
        var sourceSrc = sources[index].getAttribute("data-src");
        if (!sourceSrc) continue;
        sources[index].setAttribute("src", sourceSrc);
        assignedSource = true;
      }
  
      video.setAttribute("data-lazy-loaded", "true");
      video.removeAttribute("data-lazy-video-load-observed");
      if (assignedSource) {
        video.preload = "auto";
        video.setAttribute("preload", "auto");
        video.load();
      }
    }
  
    /** 自动播放视口内的视频；浏览器拒绝自动播放时静默保留封面。 */
    function playLazyVideo(video) {
      loadLazyVideo(video);
      var playPromise = video.play();
  
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(function (error) {
          if (error && error.name !== "AbortError") {
            console.warn("[page-shoping] Lazy video autoplay was blocked.", error);
          }
        });
      }
    }
  
    /** 创建一次 Observer，并扫描初始页面或后来载入的 Shopify Section。 */
    function initializeLazyMedia(root) {
      var images = getLazyTargets(root, ".js-lazy-image");
      var videos = getLazyTargets(root, ".js-lazy-video");
  
      if (!("IntersectionObserver" in window)) {
        images.forEach(loadLazyImage);
        videos.forEach(loadLazyVideo);
        return;
      }
  
      if (!lazyImageObserver) {
        lazyImageObserver = new window.IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            loadLazyImage(entry.target);
            lazyImageObserver.unobserve(entry.target);
          });
        }, {
          rootMargin: "0px 0px 1300px 0px",
          threshold: 0
        });
      }
  
      if (!lazyVideoLoadObserver) {
        lazyVideoLoadObserver = new window.IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            loadLazyVideo(entry.target);
            lazyVideoLoadObserver.unobserve(entry.target);
          });
        }, {
          rootMargin: "0px 0px 600px 0px",
          threshold: 0
        });
      }
  
      if (!lazyVideoPlayObserver) {
        lazyVideoPlayObserver = new window.IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
              playLazyVideo(entry.target);
            } else {
              entry.target.pause();
            }
          });
        }, {
          threshold: [0, 0.35]
        });
      }
  
      images.forEach(function (image) {
        if (image.getAttribute("data-lazy-loaded") === "true") return;
        if (image.getAttribute("data-lazy-image-observed") === "true") return;
        image.setAttribute("data-lazy-image-observed", "true");
        lazyImageObserver.observe(image);
      });
  
      videos.forEach(function (video) {
        /* 自动播放需要静音；由视口 Observer 控制播放，不使用 HTML autoplay。 */
        video.autoplay = false;
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.playsInline = true;
        video.setAttribute("muted", "");
        video.setAttribute("loop", "");
        video.setAttribute("playsinline", "");
        video.setAttribute("preload", "none");
        video.removeAttribute("autoplay");
  
        if (video.getAttribute("data-lazy-video-load-observed") !== "true" &&
            video.getAttribute("data-lazy-loaded") !== "true") {
          video.setAttribute("data-lazy-video-load-observed", "true");
          lazyVideoLoadObserver.observe(video);
        }
  
        if (video.getAttribute("data-lazy-video-play-observed") !== "true") {
          video.setAttribute("data-lazy-video-play-observed", "true");
          lazyVideoPlayObserver.observe(video);
        }
      });
    }
  
    // 移除掉默认头部header-wrapper
    function removeDefaultHeader() {
      $(".section-header").remove();
    }
  
    // 打开移动菜单的动态绑定
    function openHeaderMenu() {
      var header = document.querySelector("[data-sp-header]");
      if (!header || header.getAttribute("data-sp-menu-bound") === "true") return;
      var drawer = header.querySelector(".sph__drawer");
      var backdrop = header.querySelector(".sph__drawer-backdrop");
      var toggle = header.querySelector(".sph__menu-toggle");
      if (!drawer || !backdrop || !toggle) return;
      header.setAttribute("data-sp-menu-bound", "true");

      function setMenuOpen(isOpen, restoreFocus) {
        drawer.classList.toggle("is-open", isOpen);
        backdrop.classList.toggle("is-open", isOpen);
        drawer.setAttribute("aria-hidden", isOpen ? "false" : "true");
        drawer.inert = !isOpen;
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        toggle.setAttribute("aria-label", isOpen ? "Zatvorite navigacijski izbornik" : "Otvorite navigacijski izbornik");
        document.body.classList.toggle("sp-header-menu-open", isOpen);
        if (isOpen) {
          drawer.querySelector(".sph__drawer-close").focus();
        } else if (restoreFocus) {
          toggle.focus();
        }
      }

      header.addEventListener("click", function (event) {
        var trigger = event.target.closest(".js-header-menu-btn, [data-sp-header-menu-close]");
        if (!trigger || !header.contains(trigger)) return;
        if (trigger === toggle) {
          setMenuOpen(!drawer.classList.contains("is-open"), true);
        } else {
          setMenuOpen(false, true);
        }
      });

      document.addEventListener("keydown", function (event) {
        if (!drawer.classList.contains("is-open")) return;
        if (event.key === "Escape") {
          event.preventDefault();
          setMenuOpen(false, true);
          return;
        }
        if (event.key !== "Tab") return;
        var controls = drawer.querySelectorAll("button:not([disabled]), a[href]");
        var first = controls[0];
        var last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });

      window.addEventListener("resize", function () {
        if (window.innerWidth >= 768 && drawer.classList.contains("is-open")) {
          setMenuOpen(false, false);
        }
      });
      setMenuOpen(false, false);
    }
  
    /** 视口渐出动画：进入视口 10% 后添加 is-visible，并且只播放一次。 */
    function initializeRevealOnScroll() {
      const observerOptions = {
        root: null,
        rootMargin: "0px",
        threshold: 0.1
      };
  
      const elements = document.querySelectorAll(".reveal-on-scroll");
      if (!elements.length) return;
  
      if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver((entries, observer) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer.unobserve(entry.target);
            }
          });
        }, observerOptions);
  
        elements.forEach((section) => {
          observer.observe(section);
        });
      } else {
        elements.forEach((section) => {
          section.classList.add("is-visible");
        });
      }
    }
  
  
    /** 注册所有“类名即功能”的委托事件，新增加的同类按钮无需再次写 JS。 */
    function bindSharedEvents() {
      
      $document
        .off("click.spShopping", ".js-option")
        .on("click.spShopping", ".js-option", function (event) {
          event.preventDefault();
          if ($(this).hasClass("is-disabled")) return;
          var optionIndex = Number($(this).closest(".js-opt-group").attr("data-option-index"));
          setOption(optionIndex, $(this).attr("data-val"));
        });
  
      $document
        .off("click.spShopping", ".js-product-thumb")
        .on("click.spShopping", ".js-product-thumb", function (event) {
          event.preventDefault();
          var targetIndex = Number($(this).attr("data-image-position"));
          if (isNaN(targetIndex)) return;
          goToProductImage(targetIndex, 350);
        });
  
      $document
        .off("click.spShopping", ".js-thumb-prev, .js-thumb-next")
        .on("click.spShopping", ".js-thumb-prev, .js-thumb-next", function (event) {
          event.preventDefault();
          if ($(this).attr("aria-disabled") === "true") return;
          stepProductImage($(this).hasClass("js-thumb-prev") ? -1 : 1);
        });
  
      $document
        .off("click.spShopping", ".js-size-guide")
        .on("click.spShopping", ".js-size-guide", function (event) {
          event.preventDefault();
          openSizeGuide();
        });
  
      $document
        .off("click.spShopping", "[data-sp-size-close]")
        .on("click.spShopping", "[data-sp-size-close]", function (event) {
          event.preventDefault();
          closeSizeGuide();
        });
  
      $document
        .off("click.spShoppingSizeBackdrop", "[data-sp-size-modal]")
        .on("click.spShoppingSizeBackdrop", "[data-sp-size-modal]", function (event) {
          if (event.target === this) closeSizeGuide();
        });
  
      $document
        .off("change.spShopping", ".js-variant-select")
        .on("change.spShopping", ".js-variant-select", function () {
          setOption(Number($(this).attr("data-option-index")), $(this).val());
        });
  
      $document
        .off("click.spShopping", ".js-reduce")
        .on("click.spShopping", ".js-reduce", function (event) {
          event.preventDefault();
          setQuantity(state.quantity - 1);
        });
  
      $document
        .off("click.spShopping", ".js-add")
        .on("click.spShopping", ".js-add", function (event) {
          event.preventDefault();
          setQuantity(state.quantity + 1);
        });
  
      $document
        .off("input.spShopping change.spShopping", ".js-calcNumber")
        .on("input.spShopping change.spShopping", ".js-calcNumber", function () {
          setQuantity($(this).val());
        });
  
      $document
        .off("click.spShopping", ".js-add-cart")
        .on("click.spShopping", ".js-add-cart", function (event) {
          event.preventDefault();
          if ($(this).hasClass("js-fixed-purchase__cart") && !state.hasUserSelectedOptions && productOptions.length > 0) {
            openCartDrawer();
            return;
          }
          addToCart($(this));
        });
  
      $document
        .off("click.spShopping", ".js-buy-now")
        .on("click.spShopping", ".js-buy-now", function (event) {
          event.preventDefault();
          buyNow();
        });
  
      $document
        .off("click.spShopping", ".js-cart")
        .on("click.spShopping", ".js-cart", function (event) {
          event.preventDefault();
          openCartDrawer();
        });
  
      $document.on("click.spShopping", "[data-sp-drawer-close], [data-sp-drawer-overlay]", function (event) {
        event.preventDefault();
        closeCartDrawer();
      });
  
      $document.on("keydown.spShopping", function (event) {
        if (event.key === "Tab" && $("[data-sp-size-modal]").hasClass("is-open")) {
          var focusable = $(".sp-size-modal__dialog").find("button, a[href], input, select, textarea, [tabindex]").filter(":visible").filter(function () { return !this.disabled && this.tabIndex >= 0; }).get();
          var first = focusable[0], last = focusable[focusable.length - 1];
          if (first && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
        }
        if (event.key === "Escape") {
          closeCartDrawer();
          closeSizeGuide();
        }
      });
  
      $document.on("click.spShopping", "[data-sp-cart-note-toggle]", function (event) {
        event.preventDefault();
        var $button = $(this);
        var $note = $button.closest(".js-cart-drawer__note");
        var $panel = $note.find("[data-sp-cart-note-panel]");
        var shouldOpen = $panel.prop("hidden");
  
        $panel.prop("hidden", !shouldOpen);
        $note.toggleClass("is-open", shouldOpen);
        $button.attr("aria-expanded", shouldOpen ? "true" : "false");
        if (shouldOpen) window.setTimeout(function () { $note.find("[data-sp-cart-note]").trigger("focus"); }, 0);
      });
  
      $document.on("input.spShopping", "[data-sp-cart-note]", function () {
        $(this).data("dirty", true);
        $("[data-sp-cart-note-status]").text("Nespremljene promjene");
      });
  
      $document.on("click.spShopping", "[data-sp-cart-note-save]", function (event) {
        event.preventDefault();
        saveCartNote();
      });
  
      $document.on("keydown.spShopping", "[data-sp-cart-note]", function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          saveCartNote();
        }
      });
  
      $document.on("click.spShopping", ".js-drawer-qty-minus, .js-drawer-qty-plus, .js-cart-drawer__remove", function (event) {
        event.preventDefault();
        var $item = $(this).closest(".js-cart-drawer__item");
        if ($item.hasClass("is-loading")) return;
        var line = Number($item.attr("data-line"));
        var currentQuantity = Number($item.find(".js-cart-drawer__qty span").first().text()) || 1;
        var nextQuantity = currentQuantity;
  
        if ($(this).hasClass("js-drawer-qty-minus")) nextQuantity = currentQuantity - 1;
        if ($(this).hasClass("js-drawer-qty-plus")) nextQuantity = currentQuantity + 1;
        if ($(this).hasClass("js-cart-drawer__remove")) nextQuantity = 0;
        changeCartLine(line, nextQuantity, $item);
      });
    }
  
    /** 点击播放 / 再点暂停（介绍区 / 视频列表）。 */
    function initializeClickToPlayVideos() {
      function pauseOtherVideos(exceptWrap) {
        document.querySelectorAll("[data-sp-intro-video].is-playing, [data-sp-video].is-playing").forEach(function (el) {
          if (el === exceptWrap) return;
          el.classList.remove("is-playing");
          var other = el.querySelector("video");
          if (other) other.pause();
        });
      }

      function startVideo(video) {
        if (typeof playLazyVideo === "function") {
          playLazyVideo(video);
          return;
        }
        var source = video.querySelector("source[data-src]");
        if (source && source.getAttribute("data-src") && !source.getAttribute("src")) {
          source.setAttribute("src", source.getAttribute("data-src"));
          source.removeAttribute("data-src");
          video.load();
        }
        var playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(function () {});
        }
      }

      $document
        .off("click.spClickPlay", ".js-intro-play, .js-video-play")
        .on("click.spClickPlay", ".js-intro-play, .js-video-play", function (event) {
          event.preventDefault();
          var $wrap = $(this).closest("[data-sp-intro-video], [data-sp-video]");
          var video = $wrap.find("[data-sp-intro-player], [data-sp-video-player]")[0];
          if (!video) return;

          if ($wrap.hasClass("is-playing") && !video.paused) {
            video.pause();
            $wrap.removeClass("is-playing");
            return;
          }

          pauseOtherVideos($wrap[0]);
          $wrap.addClass("is-playing");
          startVideo(video);
        });

      $document
        .off("click.spClickPlayVideo", "[data-sp-intro-player], [data-sp-video-player]")
        .on("click.spClickPlayVideo", "[data-sp-intro-player], [data-sp-video-player]", function (event) {
          var $wrap = $(this).closest("[data-sp-intro-video], [data-sp-video]");
          if (!$wrap.hasClass("is-playing")) return;
          event.preventDefault();
          this.pause();
          $wrap.removeClass("is-playing");
        });
    }

    /** 普通鞋痛点视频沿用自动播放；按手机断点选择已有三角图标的封面。 */
    function initializeCauseVideoPoster() {
      var video = document.querySelector("[data-sp-cause-video]");
      if (!video) return;
      var mobile = window.matchMedia("(max-width: 767px)");
      function updatePoster() {
        var poster = video.getAttribute(mobile.matches ? "data-poster-mb" : "data-poster-pc");
        if (poster && video.getAttribute("poster") !== poster) video.setAttribute("poster", poster);
      }
      updatePoster();
      if (typeof mobile.addEventListener === "function") mobile.addEventListener("change", updatePoster);
      else mobile.addListener(updatePoster);
    }

    /** Hero video autoplays muted in a loop, with click fallback and device posters. */
    function initializeHeroVideo() {
      var video = document.querySelector('[data-sp-hero-video]');
      if (!video) return;
      var wrap = video.closest('[data-sp-hero-video-wrap]');
      var button = wrap.querySelector('[data-sp-hero-play]');
      var mobile = window.matchMedia('(max-width: 767px)');
      function updatePoster() {
        var poster = video.getAttribute(mobile.matches ? 'data-poster-mb' : 'data-poster-pc');
        if (poster && video.getAttribute('poster') !== poster) video.setAttribute('poster', poster);
      }
      updatePoster();
      mobile.addEventListener('change', updatePoster);
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      function startVideo() {
        var playing = video.play();
        if (playing && playing.catch) playing.catch(function () { wrap.classList.remove('is-playing'); });
      }
      button.addEventListener('click', startVideo);
      video.addEventListener('playing', function () {
        wrap.classList.add('is-playing');
        video.controls = false;
      });
      video.addEventListener('ended', function () {
        wrap.classList.remove('is-playing');
        video.controls = false;
      });
      video.addEventListener('error', function () {
        wrap.classList.remove('is-playing');
        video.controls = false;
      });
      startVideo();
    }

    /** 左视频右文案：确保静音自动循环播放。 */
    function initializeAutoLoopVideos() {
      document.querySelectorAll(".sp-video-right-text__video, .sp-text-image-module__video").forEach(function (video) {
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.playsInline = true;
        video.setAttribute("muted", "");
        video.setAttribute("loop", "");
        video.setAttribute("playsinline", "");
        var playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(function () {});
        }
      });
    }

    /** 页面就绪后按依赖顺序启动所有模块。 */

    /** Both breakpoints use the same measured-height masonry algorithm. */
    function initializeReviews() {
      var grid = document.querySelector('.js-reviews-grid');
      if (!grid || grid.dataset.reviewsBound === 'true') return;
      var list = grid.querySelector('.lp-reviews__list');
      if (!list) return;
      grid.dataset.reviewsBound = 'true';
      var cards = Array.prototype.slice.call(list.children);
      var mobile = window.matchMedia('(max-width: 767px)');
      var columns = [];
      var layoutFrame = 0;
      function layout() {
        layoutFrame = 0;
        if (!columns.length) return;
        var measured = cards.map(function (card, index) {
          return { card: card, height: card.getBoundingClientRect().height, index: index };
        }).sort(function (a, b) { return b.height - a.height || a.index - b.index; });
        var heights = columns.map(function () { return 0; });
        var gap = parseFloat(window.getComputedStyle(columns[0]).rowGap) || 0;
        measured.forEach(function (item) {
          var shortest = heights.indexOf(Math.min.apply(Math, heights));
          columns[shortest].appendChild(item.card);
          heights[shortest] += item.height + gap;
        });
      }
      function scheduleLayout() {
        if (!layoutFrame) layoutFrame = window.requestAnimationFrame(layout);
      }
      function sync() {
        var count = mobile.matches ? 2 : 4;
        if (columns.length !== count) {
          cards.forEach(function (card) { list.appendChild(card); });
          columns.forEach(function (column) { column.remove(); });
          columns = [];
          for (var i = 0; i < count; i++) {
            var column = document.createElement('div');
            column.className = 'lp-reviews__column';
            columns.push(column);
            list.appendChild(column);
          }
          cards.forEach(function (card, index) { columns[index % count].appendChild(card); });
        }
        scheduleLayout();
      }
      sync();
      mobile.addEventListener('change', sync);
      window.addEventListener('resize', sync);
      grid.querySelectorAll('img').forEach(function (image) {
        image.addEventListener('load', scheduleLayout);
        image.addEventListener('error', scheduleLayout);
      });
      if (document.fonts) document.fonts.ready.then(scheduleLayout);
    }

    /** Hide the COD tagline only when the full desktop header cannot fit. */
    function initializeHeaderFit() {
      var header = document.querySelector('.sph');
      if (!header || header.dataset.headerFitBound === 'true') return;
      var inner = header.querySelector('.sph__inner');
      var left = header.querySelector('.sph__left');
      var right = header.querySelector('.sph__right');
      if (!inner || !left || !right) return;
      header.dataset.headerFitBound = 'true';
      var frame = 0;

      function measure() {
        frame = 0;
        if (window.innerWidth <= 767) {
          header.classList.remove('sph--hide-cod');
          return;
        }
        // Measure the complete left group outside the constrained live flex row.
        // The clone is a sibling, so the hidden state never affects its measurement.
        var probe = document.createElement('div');
        probe.className = 'sph';
        probe.setAttribute('aria-hidden', 'true');
        probe.inert = true;
        probe.style.cssText = 'position:fixed;left:-10000px;top:0;width:max-content;visibility:hidden;pointer-events:none;';
        var fullLeft = left.cloneNode(true);
        fullLeft.querySelectorAll('[id]').forEach(function (node) { node.removeAttribute('id'); });
        fullLeft.style.width = 'max-content';
        fullLeft.style.flex = 'none';
        probe.appendChild(fullLeft);
        header.parentNode.appendChild(probe);
        var leftWidth = fullLeft.getBoundingClientRect().width;
        probe.remove();

        var styles = window.getComputedStyle(inner);
        var available = inner.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
        var gap = (parseFloat(styles.columnGap) || 0) + 8;
        var needed = leftWidth + right.getBoundingClientRect().width + gap;
        var hidden = header.classList.contains('sph--hide-cod');
        // An extra 8px on restore prevents flicker around the threshold.
        var shouldHide = hidden ? needed > available - 8 : needed > available;
        if (shouldHide !== hidden) header.classList.toggle('sph--hide-cod', shouldHide);
      }
      function schedule() {
        if (!frame) frame = window.requestAnimationFrame(measure);
      }
      if (typeof window.ResizeObserver === 'function') {
        var resizeObserver = new window.ResizeObserver(schedule);
        resizeObserver.observe(inner);
        resizeObserver.observe(right);
      }
      var textObserver = new window.MutationObserver(schedule);
      textObserver.observe(right, { childList: true, characterData: true, subtree: true });
      textObserver.observe(left, { childList: true, characterData: true, subtree: true });
      window.addEventListener('resize', schedule);
      header.addEventListener('load', schedule, true);
      if (document.fonts) {
        document.fonts.ready.then(schedule);
        document.fonts.addEventListener('loadingdone', schedule);
      }
      schedule();
    }

    function initializePageShopping() {
      removeDefaultHeader();
      openHeaderMenu();
      initializeHeaderFit();
      initializeRevealOnScroll();
      initializeHeroVideo();
      initializeReviews();
      initializeCauseVideoPoster();
      initializeLazyMedia(document);
      initializeClickToPlayVideos();
      initializeAutoLoopVideos();
      $document
        .off("shopify:section:load.pageShoppingLazy")
        .on("shopify:section:load.pageShoppingLazy", function (event) {
          initializeLazyMedia(event.target);
        });
      // -----------
      initializeProductState();
      initializeSwipers();
      initializeProductGallerySwiper();
      initializeProductMediaSizing();
      initializeCountdown();
      initializeDeliveryDates();
      initializeFixedPurchaseBar();
      initializePageNavigation();
      initializePageRestoreState();
      bindSharedEvents();
      $(".js-cart-drawer__checkout").attr("href", getEndpoint("checkout"));
    }
  
    /** 暴露少量公共方法，方便主题其他脚本主动调用，但状态仍由本文件统一管理。 */
    window.PageShopping = {
      addToCart: function () { addToCart($()); },
      buyNow: buyNow,
      openCart: openCartDrawer,
      closeCart: closeCartDrawer,
      refreshCart: function () { refreshCart(false); },
      setQuantity: setQuantity,
      getVariant: function () { return state.variant; },
      getState: function () { return $.extend(true, {}, state); },
      scanLazyMedia: function (root) { initializeLazyMedia(root || document); }
    };
  
    $(initializePageShopping);
  })(window.jQuery, window, document);
  
  
  // 回顶部
  (function(){
    if(window.__spToTopInit)return;
    window.__spToTopInit=true;
  
    var button=document.querySelector('.sp-to-top');
    if(!button)return;
  
    var SHOW_AFTER=500;
    var ticking=false;
  
    function update(){
      var scrollTop=
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0;
  
      button.classList.toggle('is-visible',scrollTop>SHOW_AFTER);
      ticking=false;
    }
  
    function onScroll(){
      if(ticking)return;
      ticking=true;
      window.requestAnimationFrame(update);
    }
  
    button.addEventListener('click',function(){
      window.scrollTo({
        top:0,
        behavior:'smooth'
      });
    });
  
    window.addEventListener('scroll',onScroll,{passive:true});
    window.addEventListener('pageshow',update);
  
    update();
  })();

  // 通用数字递增：任意元素加 .js-stat-num + data-sp-stat-value
  // 可选圆环：同一 [data-sp-stat-wrap] / .sp-animation-data__card 内放 .js-stat-progress
  (function(){
    if(window.__spStatCounterInit)return;
    window.__spStatCounterInit=true;

    var nums=document.querySelectorAll('.js-stat-num');
    if(!nums.length)return;

    var DURATION=1600;

    function findProgress(numEl){
      var wrap=numEl.closest('[data-sp-stat-wrap], .sp-animation-data__card');
      if(!wrap)return null;
      return wrap.querySelector('.js-stat-progress, .sp-animation-data__progress');
    }

    function getCircumference(progress){
      var radius=Number(progress.getAttribute('data-sp-stat-radius'));
      if(isNaN(radius)||radius<=0){
        radius=Number(progress.getAttribute('r'))||52;
      }
      return 2*Math.PI*radius;
    }

    function findBar(numEl){
      var article=numEl.closest('article');
      if(!article)return null;
      return article.querySelector('[data-sp-stat-bar]');
    }

    function animateNum(numEl){
      if(numEl.getAttribute('data-sp-stat-done')==='true')return;
      numEl.setAttribute('data-sp-stat-done','true');

      var progress=findProgress(numEl);
      var bar=findBar(numEl);
      var from=Number(numEl.textContent)||0;
      var target=Number(numEl.getAttribute('data-sp-stat-value'));
      if(isNaN(target))target=from;
      var start=null;

      if(progress){
        var circumference=getCircumference(progress);
        progress.style.strokeDasharray=String(circumference);
        progress.style.strokeDashoffset=String(circumference*(1-from/100));
        var wrap=numEl.closest('[data-sp-stat-wrap], .sp-animation-data__card');
        if(wrap)wrap.classList.add('is-animated');
        window.requestAnimationFrame(function(){
          progress.style.strokeDashoffset=String(circumference*(1-target/100));
        });
      }

      function step(timestamp){
        if(start===null)start=timestamp;
        var ratio=Math.min((timestamp-start)/DURATION,1);
        var eased=1-Math.pow(1-ratio,3);
        var value=from+(target-from)*eased;
        numEl.textContent=String(Math.round(value));
        if(bar)bar.style.width=value+'%';
        if(ratio<1){
          window.requestAnimationFrame(step);
        }else{
          numEl.textContent=String(target);
          if(bar)bar.style.width=target+'%';
        }
      }

      window.requestAnimationFrame(step);
    }

    function prepare(numEl){
      var progress=findProgress(numEl);
      if(!progress)return;
      var from=Number(numEl.textContent)||0;
      var circumference=getCircumference(progress);
      progress.style.strokeDasharray=String(circumference);
      progress.style.strokeDashoffset=String(circumference*(1-from/100));
    }

    if(!('IntersectionObserver' in window)){
      nums.forEach(function(numEl){
        prepare(numEl);
        animateNum(numEl);
      });
      return;
    }

    var observer=new IntersectionObserver(function(entries,obs){
      entries.forEach(function(entry){
        if(!entry.isIntersecting)return;
        animateNum(entry.target);
        obs.unobserve(entry.target);
      });
    },{threshold:0.35});

    nums.forEach(function(numEl){
      prepare(numEl);
      observer.observe(numEl);
    });
  })();


  // FAQ: initially collapsed; clicking toggles one item and synchronizes accessibility states.
  (function () {
    if (window.__lpFaqAccordionBound) return;
    window.__lpFaqAccordionBound = true;
    function setOpen(item, open) {
      var button = item.querySelector('[data-sp-faq-trigger]');
      var answer = item.querySelector('.lp-faq__answer');
      item.classList.toggle('is-open', open);
      if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (answer) {
        answer.inert = !open;
        answer.style.removeProperty('max-height');
      }
    }
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-sp-faq-trigger]');
      if (!trigger) return;
      var list = trigger.closest('[data-sp-faq-list]');
      var currentItem = trigger.closest('.lp-faq__item');
      if (!list || !currentItem) return;
      var willOpen = trigger.getAttribute('aria-expanded') !== 'true';
      list.querySelectorAll('.lp-faq__item').forEach(function (item) {
        setOpen(item, item === currentItem && willOpen);
      });
    });
  })();
