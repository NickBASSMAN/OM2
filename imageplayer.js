function ImagePlayer(params) {
  if (!params) return ImagePlayer.instance;

  if (ImagePlayer.instance) {
    ImagePlayer.instance.destroy();
  }

  this.title = params.title || "";
  this.origurl = params.url;
  this.vbox = params.vbox;
  this.width = params.width;
  this.canvas = this.vbox ? this.vbox.querySelector("canvas") : null;

  if (!(this.origurl && this.vbox && this.canvas)) {
    throw new Error("Invalid ImagePlayer params");
  }

  this.interval = params.interval || 100;
  this.images = [];
  this.errors = 0;
  this.frames = 0;
  this.showed = false;
  this.startts = Date.now();
  this.lastts = Date.now();
  this._context = this.canvas.getContext("2d");

  this._context.fillStyle = "#f3f3f3";
  this._context.fillRect(0, 0, this.canvas.width, this.canvas.height);
  this._context.fillStyle = "black";
  this._context.textAlign = "center";
  this._context.fillText("loading...", this.canvas.width / 2, this.canvas.height / 2);

  document.body.classList.add("waiting");
  this.timer = setInterval(this.update.bind(this), this.interval);
  this.vbox.style.display = "block";
  ImagePlayer.instance = this;
}

ImagePlayer.prototype.destroy = function () {
  if (typeof this.timer !== "number") return;

  clearInterval(this.timer);
  document.body.classList.remove("waiting");

  while (this.images.length) {
    const img = this.images.pop();
    img.src = "";
    img.onload = null;
    img.onerror = null;
  }

  this.vbox.style.display = "none";
  this.showed = false;
  this.timer = null;
};

ImagePlayer.prototype.imgerror = function (event) {
  const index = this.images.indexOf(event.target);
  if (index >= 0) this.images.splice(index, 1);

  this.errors++;
  if (this.errors > 5) this.destroy();
};

ImagePlayer.prototype.imgload = function (event) {
  this.errors = 0;
  this.frames++;

  const img = event.target;
  if (!this.showed) {
    document.body.classList.remove("waiting");

    if (this.width) {
      this.canvas.width = this.width;
      this.canvas.height = this.canvas.width * img.height / img.width;
    } else {
      this.canvas.width = img.width;
      this.canvas.height = img.height;
    }

    this.showed = true;
    this.vbox.style.display = "block";
  } else if (!this.vbox.matches(":hover")) {
    this.destroy();
    return;
  }

  const index = this.images.indexOf(img);
  if (index >= 0) this.images.splice(index, 1);

  this._context.drawImage(
    img,
    0,
    0,
    img.width,
    img.height,
    0,
    0,
    this.canvas.width,
    this.canvas.height
  );

  const time = Date.now() - this.startts;
  const clockwise = Boolean((time / 1000 | 0) % 2);
  const angle = 2 * Math.PI * (time % 1000) / 1000 - Math.PI / 2;

  this._context.strokeStyle = "black";
  this._context.fillStyle = "white";
  this._context.lineWidth = 2;

  this._context.beginPath();
  this._context.arc(10, this.canvas.height - 10, 5, -Math.PI / 2, angle, clockwise);
  this._context.lineTo(10, this.canvas.height - 10);
  this._context.closePath();
  this._context.stroke();
  this._context.fill();

  if (this.title) {
    this._context.strokeText(this.title, 25, this.canvas.height - 7);
    this._context.fillText(this.title, 25, this.canvas.height - 7);
  }
};

ImagePlayer.prototype.update = function () {
  const img = new Image();
  this.images.push(img);
  img.onerror = this.imgerror.bind(this);
  img.onload = this.imgload.bind(this);
  this.lastts = Date.now();

  if (this.origurl.endsWith(".")) {
    img.src = `${this.origurl}${this.lastts}`;
    return;
  }

  const separator = this.origurl.includes("?") ? "&" : "?";
  img.src = `${this.origurl}${separator}_om_preview_ts=${this.lastts}`;
};
