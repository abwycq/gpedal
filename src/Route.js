import {ssci} from './lib/smoothKernel';
import {timeout} from './lib/utils';
import {getElevationAlongPath} from './lib/gmapPromises';
import {managedLocalStorage} from './lib/managedLocalStorage';
import md5 from 'blueimp-md5';

export class RoutePoint {
  constructor({elevation, grade, smoothedGrade, distance, heading, climb, opposite, location}) {
    this.elevation = elevation;
    this.grade = grade;
    this.smoothedGrade = smoothedGrade;
    this.distance = distance;
    this.heading = heading;
    this.climb = climb;
    this.opposite = opposite;

    if(location instanceof google.maps.LatLng) {
      this.location = location;
    } else {
      this.location = new google.maps.LatLng(location.lat, location.lng);
    }
  }

  toJSON() {
    let {elevation, grade, smoothedGrade, distance, heading, climb, opposite} = this;
    let location = this.location.toJSON();
    return {elevation, grade, smoothedGrade, distance, heading, climb, opposite, location};
  }

  static fromJSON(obj) {
    return new RoutePoint(obj);
  }
}

export class GPXRoutePointFactory {
  constructor (fileBody) {
    this.fileBody = fileBody;
    this.md5 = md5(fileBody);
    this.points = [];
  }

  // NEW: Densify points while keeping elevation from the GPX file
  densifyPointsWithElevation(gpxPoints, desiredDistanceBetween = 20) {
    let densePoints = [];
    if (!gpxPoints || gpxPoints.length === 0) {
      return densePoints;
    }

    // Add first point
    let first = gpxPoints[0];
    densePoints.push(new RoutePoint({elevation: first.elevation, location: first.location}));

    for (let i = 0; i < gpxPoints.length - 1; i++) {
      let p1 = gpxPoints[i];
      let p2 = gpxPoints[i + 1];
      let dist = google.maps.geometry.spherical.computeDistanceBetween(p1.location, p2.location) || 0;

      let numSteps = Math.max(1, Math.floor(dist / desiredDistanceBetween));
      for (let step = 1; step <= numSteps; step++) {
        let pct = step / numSteps;
        let loc = google.maps.geometry.spherical.interpolate(p1.location, p2.location, pct);
        let elev = p1.elevation + (p2.elevation - p1.elevation) * pct;
        densePoints.push(new RoutePoint({elevation: elev, location: loc}));
      }
    }
    return densePoints;
  }

  expandPointsWithGradeAndHeading() {
    // (keep your existing code exactly as it is)
    for(let x=0; x<this.points.length; x++) {
      let p1 = this.points[x];
      if(x < (this.points.length - 1)) {
        let p2 = this.points[x+1];
        p1.heading = google.maps.geometry.spherical.computeHeading(p1.location, p2.location);
        let adjacent = google.maps.geometry.spherical.computeDistanceBetween(p1.location, p2.location);
        let opposite = p2.elevation - p1.elevation;
        p1.distance = adjacent;
        p1.grade = 100 * (opposite / adjacent);
        p1.opposite = opposite;
        p1.climb = opposite;
      } else {
        p1.distance = 0;
        p1.heading = 0;
        p1.grade = 0;
        p1.opposite = 0;
        p1.climb = 0;
      }
    }
    let grades = this.points.map((p,i) => {return [i,p.grade]});

    let smoothed_grades_obj = ssci.smooth.kernel2()
                              .kernel("Gaussian")
                              .data(grades)
                              .scale(2);
    smoothed_grades_obj();
    let smoothed_grades = smoothed_grades_obj.output();
    for(let x=0; x<this.points.length; x++) {
      this.points[x].smoothedGrade = smoothed_grades[x][1];
      if(this.points[x].smoothedGrade < 0.95 || this.points[x].climb < 0) {
        this.points[x].climb = 0;
      }
    }
  }

  async expandPointsWithElevation(gpxPoints) {
    // (keep your existing Google Elevation code exactly as it is)
    let start=0;
    let desiredDistanceBetween = 20;
    let maxPoints = 512;
    let maxDistance = maxPoints * desiredDistanceBetween;

    while(start < gpxPoints.length) {
      if(start > 0) {
        await timeout(4000);
      }

      let points_slice = [];
      let distance_slice = 0;
      let count_slice = 0;
      for(let x=start; x<gpxPoints.length; x++) {
        let p1 = gpxPoints[x];
        let distance = 0;
        if(x < (gpxPoints.length - 1)) {
          let p2 = gpxPoints[x+1];
          distance = google.maps.geometry.spherical.computeDistanceBetween(p1.location, p2.location);
        }
        distance_slice += distance;
        count_slice += 1;
        if(distance_slice <= maxDistance && count_slice < maxPoints) {
          points_slice.push(p1.location);
        } else {
          count_slice -= 1;
          distance_slice -= distance;
          break;
        }
      }

      let elevationRequest = {
        'path': points_slice,
        'samples': Math.ceil(distance_slice / desiredDistanceBetween),
      }

      let elevations = await getElevationAlongPath(elevationRequest);
      let elevationPoints = elevations.map(e => {
        return new RoutePoint({elevation: e.elevation, location: e.location});
      });
      Array.prototype.push.apply(this.points, elevationPoints);
      start = count_slice + start;
    }
  }

  async create() {
    // Parse GPX and check for elevation data
    let gpxParser = new DOMParser();
    let gpxDom = gpxParser.parseFromString(this.fileBody, "text/xml");
    let gpxPoints = Array.from(gpxDom.documentElement.getElementsByTagName('trkpt')).map(p => {
      let lat = parseFloat(p.getAttribute('lat')),
          lng = parseFloat(p.getAttribute('lon'));
      let eleEl = p.getElementsByTagName('ele')[0];
      let elevation = (eleEl && eleEl.textContent) ? parseFloat(eleEl.textContent.trim()) : null;

      let opts = { location: { lat, lng } };
      if (elevation !== null && !isNaN(elevation)) {
        opts.elevation = elevation;
      }
      return new RoutePoint(opts);
    });

    let hasElevations = gpxPoints.length > 0 &&
      gpxPoints.every(p => typeof p.elevation === 'number' && !isNaN(p.elevation));

    let cachePrefix = hasElevations ? 'gpx-elev-cache-' : 'gpx-cache-';
    let cacheName = cachePrefix + this.md5;

    let raw = managedLocalStorage.get(cacheName);
    if (raw !== undefined && raw !== null) {
      managedLocalStorage.unshift('gpx-cache', cacheName);
      this.points = raw.map(r => { return RoutePoint.fromJSON(r) });
    } else {
      if (hasElevations) {
        this.points = this.densifyPointsWithElevation(gpxPoints);
      } else {
      // No elevation in GPX → make a flat route (no Google API call)
      this.points = gpxPoints.map(p => {
        return new RoutePoint({
          elevation: 0,
          location: p.location
        });
      });
    }
      this.expandPointsWithGradeAndHeading();

      managedLocalStorage.add('gpx-cache', cacheName, this.points);
    }

    return this.points;
  }
}
