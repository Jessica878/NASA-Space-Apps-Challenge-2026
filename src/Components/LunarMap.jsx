

import { useEffect, useRef } from "react";

import Map from "ol/Map.js";
import View from "ol/View.js";

import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import LineString from "ol/geom/LineString.js";

import VectorLayer from "ol/layer/Vector.js";
import ImageLayer from "ol/layer/Image.js";
import VectorSource from "ol/source/Vector.js";
import ImageStatic from "ol/source/ImageStatic.js";

import {
  Style,
  Stroke,
  Fill,
  Circle as CircleStyle,
} from "ol/style.js";

import {
  get as getProjection,
  fromLonLat,
  toLonLat,
} from "ol/proj.js";

import proj4 from "proj4";
import { register } from "ol/proj/proj4.js";

import "ol/ol.css";
import "./LunarMap.css";

const MOON_RADIUS = 1737400;

const IMAGE_EXTENT = [
  -931100,
  -931100,
  931100,
  931100,
];

proj4.defs(
  "LUNAR:SP",
  "+proj=stere +lat_0=-90 +lon_0=0 +k=1 " +
  "+x_0=0 +y_0=0 +a=1737400 +b=1737400 " +
  "+units=m +no_defs"
);

register(proj4);

const lunarProjection = getProjection("LUNAR:SP");

lunarProjection.setExtent(IMAGE_EXTENT);

function createGrid() {
  const features = [];

  // Latitude circles
  for (let latitude = -60; latitude >= -88; latitude -= 2) {
    const coordinates = [];

    for (let longitude = -180; longitude <= 180; longitude += 2) {
      coordinates.push(
        fromLonLat([longitude, latitude], lunarProjection)
      );
    }

    features.push(
      new Feature({
        geometry: new LineString(coordinates),
      })
    );
  }

  // Longitude lines
  for (let longitude = -180; longitude < 180; longitude += 30) {
    const coordinates = [];

    for (let latitude = -60; latitude >= -90; latitude -= 1) {
      coordinates.push(
        fromLonLat([longitude, latitude], lunarProjection)
      );
    }

    features.push(
      new Feature({
        geometry: new LineString(coordinates),
      })
    );
  }

  return features;
}

export default function LunarMap({
  selectedLocation,
  onLocationSelect,
}) {
  const mapElement = useRef(null);
  const markerSource = useRef(null);

  useEffect(() => {
    if (!mapElement.current) return;

    // NASA South Pole image layer
    const moonImageLayer = new ImageLayer({
      source: new ImageStatic({
        url: "/moon/south-pole-mosaic.png",
        imageExtent: IMAGE_EXTENT,
        projection: lunarProjection,
        interpolate: true,
      }),
    });

    // Coordinate grid layer
    const gridSource = new VectorSource({
      features: createGrid(),
    });

    const gridLayer = new VectorLayer({
      source: gridSource,
      style: new Style({
        stroke: new Stroke({
          color: "rgba(125, 181, 215, 0.65)",
          width: 1,
        }),
      }),
    });

    // Selected landing site marker
    markerSource.current = new VectorSource();

    const markerLayer = new VectorLayer({
      source: markerSource.current,
      style: new Style({
        image: new CircleStyle({
          radius: 8,
          fill: new Fill({
            color: "#f4b860",
          }),
          stroke: new Stroke({
            color: "#ffffff",
            width: 2,
          }),
        }),
      }),
    });

    const map = new Map({
      target: mapElement.current,

      layers: [
        moonImageLayer,
        gridLayer,
        markerLayer,
      ],

      view: new View({
        projection: lunarProjection,
        center: [0, 0],
        zoom: 1.5,
        minZoom: 0,
        maxZoom: 8,
      }),
    });

    map.on("singleclick", (event) => {
      const [longitude, latitude] = toLonLat(
        event.coordinate,
        lunarProjection
      );

            // Allow clicks anywhere on the displayed map
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const normalizedLongitude =
        ((longitude + 180) % 360 + 360) % 360 - 180;

      onLocationSelect({
        latitude: Number(latitude.toFixed(4)),
        longitude: Number(normalizedLongitude.toFixed(4)),
      });
    });

    return () => {
      map.setTarget(undefined);
    };
  }, [onLocationSelect]);

  useEffect(() => {
    if (!markerSource.current || !selectedLocation) return;

    const { latitude, longitude } = selectedLocation;

    if (
      latitude === "" ||
      longitude === "" ||
      !Number.isFinite(Number(latitude)) ||
      !Number.isFinite(Number(longitude))
    ) {
      markerSource.current.clear();
      return;
    }

    markerSource.current.clear();

    const marker = new Feature({
      geometry: new Point(
        fromLonLat(
          [Number(longitude), Number(latitude)],
          lunarProjection
        )
      ),
    });

    markerSource.current.addFeature(marker);
  }, [selectedLocation]);

  return (
    <div className="lunar-map-wrapper">
      <div className="lunar-map-header">
        <div>
          <span className="map-eyebrow">LUNAR CARTOGRAPHY</span>
          <h3>South Pole Explorer</h3>
        </div>

        <span className="map-status">NASA LROC WAC Mosaic</span>
      </div>

      <div
        ref={mapElement}
        className="lunar-map"
      />

      <div className="map-footer">
        <span>Moon2000 South Polar Stereographic</span>
        <span>100 m/pixel original resolution</span>
      </div>

      <p className="map-instruction">
        Click anywhere between 60°S and the lunar south pole
        to select a coordinate.
      </p>
    </div>
  );
}
