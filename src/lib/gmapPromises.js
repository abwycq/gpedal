let _elevationService = null;
let _streetViewService = null;
let _geocoder = null;

function getElevationService() {
  if (!_elevationService) {
    _elevationService = new google.maps.ElevationService();
  }
  return _elevationService;
}

function getStreetViewService() {
  if (!_streetViewService) {
    _streetViewService = new google.maps.StreetViewService();
  }
  return _streetViewService;
}

function getGeocoder() {
  if (!_geocoder) {
    _geocoder = new google.maps.Geocoder();
  }
  return _geocoder;
}

export function geocode(location) {
  return new Promise(function(resolve,reject) {
    getGeocoder().geocode({'location': location}, function(results, status) {
      if (status === 'OK') {
        resolve(results);
      } else {
        reject(new Error(status));
      }
    });
  });
}

export function getPanoramaByLocation(location, radius) {
  return new Promise(function(resolve,reject) {
    let request = {
      location: location,
      radius: radius
    };
    getStreetViewService().getPanorama(request, (results, status) => {
      if (status == google.maps.StreetViewStatus.OK) {
        resolve(results);
      } else {
        reject(new Error(status));
      }
    });
  });
}

export function getElevationAlongPath(elevationRequest) {
  return new Promise(function(resolve,reject) {
    getElevationService().getElevationAlongPath(elevationRequest, (results, status) => {
      if (status == google.maps.ElevationStatus.OK) {
        resolve(results);
      } else {
        reject(new Error(status));
      }
    });
  });
}
