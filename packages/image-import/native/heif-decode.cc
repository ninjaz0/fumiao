#include <libheif/heif.h>
#include <libheif/heif_properties.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>

// One private staged file per process. The parent bounds input bytes, timeout,
// output bytes and concurrency; libheif's own parsing limits remain enabled.
int main(int argc, char** argv) {
  const bool transforms = argc == 3 && !strcmp(argv[1], "--transforms");
  if (argc != 2 && !transforms) return 2;
  std::unique_ptr<heif_context, decltype(&heif_context_free)> context(heif_context_alloc(), heif_context_free);
  if (!context) return 3;
  heif_context_set_max_decoding_threads(context.get(), 1);
  if (heif_context_read_from_file(context.get(), argv[transforms ? 2 : 1], nullptr).code) return 4;
  if (transforms) {
    heif_item_id primary;
    if (heif_context_get_primary_image_ID(context.get(), &primary).code) return 5;
    heif_property_id properties[16];
    const int count = heif_item_get_transformation_properties(context.get(), primary, nullptr, 0);
    if (count < 0 || count > 16) return 6;
    if (heif_item_get_transformation_properties(context.get(), primary, properties, 16) != count) return 6;
    printf("[");
    bool comma = false;
    for (int i=0; i<count; ++i) {
      const auto type = heif_item_get_property_type(context.get(), primary, properties[i]);
      if (type == heif_item_property_type_transform_rotation) {
        const int angle = heif_item_get_property_transform_rotation_ccw(context.get(), primary, properties[i]);
        if (angle < 0 || angle > 270 || angle % 90) return 6;
        printf("%s{\"type\":\"rotate\",\"value\":%d}", comma ? "," : "", angle);
        comma = true;
      } else if (type == heif_item_property_type_transform_mirror) {
        const int direction = heif_item_get_property_transform_mirror(context.get(), primary, properties[i]);
        if (direction != 0 && direction != 1) return 6;
        printf("%s{\"type\":\"mirror\",\"value\":%d}", comma ? "," : "", direction);
        comma = true;
      }
      // Pillow/libavif exposes irot/imir as EXIF orientation, not clap cropping.
    }
    return printf("]") < 0 || fflush(stdout) ? 9 : 0;
  }
  heif_image_handle* raw_handle = nullptr;
  if (heif_context_get_primary_image_handle(context.get(), &raw_handle).code) return 5;
  std::unique_ptr<heif_image_handle, decltype(&heif_image_handle_release)> handle(raw_handle, heif_image_handle_release);
  const int width = heif_image_handle_get_width(handle.get()), height = heif_image_handle_get_height(handle.get());
  if (width <= 0 || height <= 0 || int64_t(width) * height > 64000000) return 6;
  const bool alpha = heif_image_handle_has_alpha_channel(handle.get());
  std::unique_ptr<heif_decoding_options, decltype(&heif_decoding_options_free)> options(heif_decoding_options_alloc(), heif_decoding_options_free);
  if (!options) return 3;
  options->convert_hdr_to_8bit = true;
  options->num_codec_threads = 1;
  heif_image* raw_image = nullptr;
  if (heif_decode_image(handle.get(), &raw_image, heif_colorspace_RGB,
      alpha ? heif_chroma_interleaved_RGBA : heif_chroma_interleaved_RGB, options.get()).code) return 7;
  std::unique_ptr<heif_image, decltype(&heif_image_release)> image(raw_image, heif_image_release);
  const uint32_t w = heif_image_get_width(image.get(), heif_channel_interleaved);
  const uint32_t h = heif_image_get_height(image.get(), heif_channel_interleaved), channels = alpha ? 4 : 3;
  if (!w || !h || uint64_t(w) * h > 64000000) return 6;
  size_t stride = 0;
  const auto* pixels = heif_image_get_plane_readonly2(image.get(), heif_channel_interleaved, &stride);
  if (!pixels || stride < size_t(w)*channels) return 8;
  unsigned char header[16] = {'F','M','I','1'};
  for (int i=0; i<4; ++i) {
    header[4+i] = (w >> (i*8)) & 255;
    header[8+i] = (h >> (i*8)) & 255;
    header[12+i] = (channels >> (i*8)) & 255;
  }
  if (fwrite(header,1,sizeof(header),stdout)!=sizeof(header)) return 9;
  for (uint32_t y=0;y<h;++y)
    if (fwrite(pixels+y*stride,1,size_t(w)*channels,stdout)!=size_t(w)*channels) return 9;
  return fflush(stdout) ? 9 : 0;
}
