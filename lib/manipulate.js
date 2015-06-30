/*
Manipulate an image with GM, following the steps from the request options.
  - can resize, make square, or crop
@author: James Nicol, www.friesh.com, May 2013
*/

'use strict';

var Q, fs, gm, path;

fs = require('fs');
path = require('path');
gm = require('gm');
Q  = require('q');


module.exports = function(img, stream) {
  var cropX, cropY, deferred, ht, m, newHt, newWd,
      onClose, resizeHeight, resizeWidth, wd;

  deferred = Q.defer();

  // Handle the close event of the write stream
  onClose = function() {
    // determine the file size and store it to the image object
    fs.stat(img.tmpFile, function(err, stat) {
      if (err) {
        deferred.reject(err);
      } else {
        img.size = stat.size;
        deferred.resolve(img);
      }
    });
  };

  // add watermark to image
  var addWatermark = function() {

    // apply watermark last, because gm doesn't support getting image size after
    // resizing/cropping
    if (img.options.watermark) {
      var watermarkPath = path.resolve(__dirname + '/../assets/watermark.png'),
          // in percent
          minWatermarkHeight = 20,
          maxWatermarkHeight = 45,

          // in percent
          watermarkOpacity = 30,
          watermarkPosition = 'Center',
          originalHeightThreshold = 300;

      // get new image dimension
      gm(fs.createReadStream(img.tmpFile))
        .size(function(err, orgSize) {
          if (err) {
            return deferred.reject(err);
          }

          // get watermark dimension
          gm(fs.createReadStream(watermarkPath))
            .size(function(err, watermarkSize) {
              if (err) {
                return deferred.reject(err);
              }

              // when image is really small, the watermark will
              // become very small so we need some threshold here
              if (orgSize.height < originalHeightThreshold) {
                minWatermarkHeight = maxWatermarkHeight;
              }

              // normalize original image's height so we'll get
              // same watermark size
              var normalizeOrgHeight = orgSize.height - (orgSize.height % 100)

              // 30% of S3 image
              var wh = normalizeOrgHeight / 100 * minWatermarkHeight,
                  ww = wh / watermarkSize.height * watermarkSize.width;

              // add watermark
              gm()
                .command('composite')
                .in('-dissolve', watermarkOpacity + '%')
                .in('-gravity', watermarkPosition)
                .in('-geometry', wh + 'x' + ww)
                .in(watermarkPath)
                .in(img.tmpFile)
                .write(img.tmpFile, function() {
                  if (err) {
                    deferred.reject(new Error(err));
                  } else {
                    onClose();
                  }
                });
            });
        });
    } else {
      onClose();
    }
  }

  var imageQuality = (typeof img.options.quality == 'undefined' ? 75 : img.options.quality);

  // create a GM object based in the incoming stream
  m = gm(stream, img.filename());

  // manipulate the image based on the options
  switch (img.options.action) {

  case 'resize':
    m.resize(img.options.width, img.options.height).quality(imageQuality);
    break;

  case 'fit':
    m.compress('JPEG').resize(img.options.width, img.options.height, '^').gravity('Center').extent(img.options.width, img.options.height).quality(imageQuality);
    break;

  case 'fill':
//    m = gm(img.options.width, img.options.height, '#' + img.options.bgcolor);
    m.background('#' + img.options.bgcolor)
     .gravity('Center')
     .resize(img.options.width, img.options.height, '>')
     .extent(img.options.width, img.options.height)
     .fill('#' + img.options.bgcolor)
     .quality(imageQuality);
    break;

  case 'square':
    // determine the resize coords, based on the smallest dimension
    if (img.origDims.width >= img.origDims.height) {

      // need to check for situations where the requested size is bigger than
      // the original dimension.
      //  eg: s=640 for original height of 318.
      //      - in this situation set the resize dims to original
      if (img.options.height > img.origDims.height) {
        resizeWidth = resizeHeight = img.origDims.height;
      } else {
        resizeWidth = resizeHeight = img.options.height;
      }

      ht = newHt = resizeHeight;
      wd = null;
      newWd = ht / img.origDims.height * img.origDims.width;
      cropX = Math.round((newWd - newHt) / 2);
      cropY = 0;

    } else {
      if (img.options.width > img.origDims.width) {
        resizeWidth = resizeHeight = img.origDims.width;
      } else {
        resizeWidth = resizeHeight = img.options.width;
      }

      ht = null;
      wd = newWd = resizeWidth;
      newHt = wd / img.origDims.width * img.origDims.height;
      cropX = 0;
      cropY = Math.round((newHt - newWd) / 2);
    }

    // resize then crop the image
    m.resize(wd, ht);
    m.quality(imageQuality);
    m.crop(resizeWidth, resizeHeight, cropX, cropY);
    break;

  case 'crop':
    m.crop(
      img.options.width,
      img.options.height,
      img.options.cropX,
      img.options.cropY
    ).quality(imageQuality);
  }

  if (img.options.blur && img.options.blur == true) {
  	m.blur(img.options.blurRadius, img.options.blurSigma);
  }

  if (img.options.modulate && img.options.modulate == true) {
  	m.modulate(img.options.modulateBrightness, img.options.modulateSaturation, img.options.modulateHue);
  }

  // make sure there is no EXIF data on the image
  m.noProfile();

  // write the image to disk
  m.write(img.tmpFile, function(err) {
    if (err) {
      deferred.reject(new Error(err));
    } else {
      addWatermark();
    }
  });

  // return a promise
  return deferred.promise;
};